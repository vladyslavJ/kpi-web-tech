## `run.sh`

```bash
#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  echo "Run this script with bash: ./run.sh <dev|prod>" >&2
  exit 1
fi

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ROOT
readonly BOT_DIR="$ROOT/bot"
readonly VENV="$BOT_DIR/.venv"
readonly PYTHON="$VENV/bin/python"
readonly PORT="${PORT:-8000}"
readonly MIN_PYTHON_MINOR=12
readonly STOP_TIMEOUT_SECONDS=10

if [[ -t 1 ]]; then
  readonly COLOR=1
else
  readonly COLOR=0
fi

SERVICE_PIDS=()

usage() {
  cat <<EOF
Usage: ./run.sh <dev|prod>

  dev   development mode: the bot polls Telegram and restarts on code changes, status page at http://localhost:${PORT}
  prod  lint and type check, then the bot runs with production settings, status page at http://localhost:${PORT}
EOF
}

paint() {
  if (( COLOR )); then
    printf '\033[%sm%s\033[0m' "$1" "$2"
  else
    printf '%s' "$2"
  fi
}

info() {
  printf '%s %s\n' "$(paint '1;36' '[run]')" "$*"
}

fail() {
  printf '%s %s\n' "$(paint '1;31' '[run]')" "$*" >&2
  exit 1
}

check_requirements() {
  if (( BASH_VERSINFO[0] < 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] < 3) )); then
    fail "bash 4.3 or newer is required, found ${BASH_VERSION}"
  fi
  command -v setsid >/dev/null 2>&1 || fail "setsid not found (install the util-linux package)"
  command -v python3 >/dev/null 2>&1 || fail "Python not found, version 3.${MIN_PYTHON_MINOR}+ is required"
  local minor
  minor="$(python3 -c 'import sys; print(sys.version_info.minor if sys.version_info.major == 3 else 0)')"
  (( minor >= MIN_PYTHON_MINOR )) || fail "Python 3.${MIN_PYTHON_MINOR}+ is required, found $(python3 --version)"
  python3 -c 'import venv, ensurepip' 2>/dev/null || fail "Python venv module not found (install the python3-venv package)"
}

check_settings() {
  if [[ ! -f "$BOT_DIR/.env" && -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
    fail "bot/.env not found: copy bot/.env.example to bot/.env and fill in TELEGRAM_BOT_TOKEN and GROQ_API_KEY"
  fi
}

port_open() {
  (exec 3<>"/dev/tcp/localhost/$1") 2>/dev/null
}

ensure_port_free() {
  if port_open "$1"; then
    fail "Port $1 is already in use: stop the process that is using it or set PORT"
  fi
}

install_dependencies() {
  local stamp="$VENV/.requirements.stamp"
  if [[ ! -x "$PYTHON" ]]; then
    info "bot: creating a virtual environment"
    python3 -m venv "$VENV"
  fi
  if [[ ! -f "$stamp" || "$BOT_DIR/requirements.txt" -nt "$stamp" || "$BOT_DIR/requirements-dev.txt" -nt "$stamp" ]]; then
    info "bot: installing dependencies"
    "$PYTHON" -m pip install --quiet --disable-pip-version-check -r "$BOT_DIR/requirements-dev.txt"
    touch "$stamp"
  fi
}

check_code() {
  info "bot: linting"
  (cd "$BOT_DIR" && "$VENV/bin/ruff" check --quiet . && "$VENV/bin/ruff" format --check --quiet .)
  info "bot: type checking"
  (cd "$BOT_DIR" && "$VENV/bin/mypy")
}

prefix_lines() {
  trap '' INT TERM
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    printf '%s %s\n' "$1" "$line"
  done
}

start_service() {
  local app="$1" color="$2" label
  shift 2
  label="$(paint "$color" "[$app]")"
  setsid bash -c 'set -o pipefail; label="$1"; cd "$2" && shift 2 && "$@" 2>&1 | prefix_lines "$label"' \
    "$app" "$label" "$BOT_DIR" "$@" </dev/null &
  SERVICE_PIDS+=("$!")
}

all_services_running() {
  local pid
  for pid in "${SERVICE_PIDS[@]}"; do
    kill -0 "$pid" 2>/dev/null || return 1
  done
}

wait_until_ready() {
  local port ready
  while all_services_running; do
    ready=1
    for port in "$@"; do
      if ! port_open "$port"; then
        ready=0
        break
      fi
    done
    if (( ready )); then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

any_service_alive() {
  local pid
  for pid in "${SERVICE_PIDS[@]}"; do
    if kill -0 -- "-$pid" 2>/dev/null; then
      return 0
    fi
  done
  return 1
}

stop_services() {
  (( ${#SERVICE_PIDS[@]} > 0 )) || return 0
  trap '' INT TERM
  info "stopping services"
  local pid deadline=$(( SECONDS + STOP_TIMEOUT_SECONDS ))
  for pid in "${SERVICE_PIDS[@]}"; do
    kill -TERM -- "-$pid" 2>/dev/null || true
  done
  while any_service_alive && (( SECONDS < deadline )); do
    sleep 0.2
  done
  for pid in "${SERVICE_PIDS[@]}"; do
    kill -KILL -- "-$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  SERVICE_PIDS=()
  info "stopped"
}

main() {
  if [[ $# -ne 1 ]]; then
    usage >&2
    return 2
  fi
  local mode="$1"
  case "$mode" in
    dev | prod) ;;
    -h | --help)
      usage
      return 0
      ;;
    *)
      usage >&2
      return 2
      ;;
  esac

  check_requirements
  check_settings
  ensure_port_free "$PORT"

  install_dependencies
  if [[ "$mode" == prod ]]; then
    check_code
  fi

  trap stop_services EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  export -f prefix_lines
  export PORT PYTHONPATH="$BOT_DIR/src" PYTHONUNBUFFERED=1

  if [[ "$mode" == dev ]]; then
    info "starting in development mode"
    export APP_ENV=development LOG_FORMAT=text
    start_service bot '35' "$VENV/bin/watchfiles" --filter python --sigint-timeout 5 \
      "$(printf '%q' "$PYTHON") -m bot run" src
  else
    info "starting in production mode"
    export APP_ENV=production LOG_FORMAT=json
    start_service bot '35' "$PYTHON" -m bot run
  fi

  if wait_until_ready "$PORT"; then
    info "$(paint '1;32' "Application is ready to use: http://localhost:${PORT}") (Ctrl+C to stop)"
  fi

  local status=0
  wait -n || status=$?
  info "a service exited with code $status, stopping the rest"
  return "$status"
}

main "$@"
```

## `bot/.env.example`

```dotenv
TELEGRAM_BOT_TOKEN=
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-120b
GROQ_REASONING_EFFORT=low
WEBHOOK_BASE_URL=
WEBHOOK_SECRET=
CONTACT_PHONE=
CONTACT_EMAIL=
CONTACT_TELEGRAM=
CONTACT_GITHUB=
PORT=8000
LOG_LEVEL=INFO
```

## `bot/pyproject.toml`

```toml
[project]
name = "lab-03-telegram-bot"
version = "1.0.0"
description = "Telegram bot with a menu and AI prompts: Python 3.12, pyTelegramBotAPI, Flask, Groq"
requires-python = ">=3.12"

[tool.ruff]
line-length = 100
target-version = "py312"
src = ["src"]
extend-exclude = [".venv", "data"]

[tool.ruff.format]
quote-style = "single"

[tool.ruff.lint]
select = ["E", "W", "F", "I", "N", "B", "UP", "SIM", "RUF", "S", "PTH", "RET", "C4", "PIE", "PL"]
ignore = ["PLR2004", "PLR0913", "RUF001"]

[tool.mypy]
python_version = "3.12"
strict = true
mypy_path = "src"
packages = ["bot"]
plugins = ["pydantic.mypy"]
warn_unreachable = true
untyped_calls_exclude = ["telebot"]

[tool.pytest.ini_options]
pythonpath = ["src", "../tmp/tests"]
testpaths = ["../tmp/tests"]
addopts = "-ra"
```

## `bot/requirements-dev.txt`

```text
-r requirements.txt
mypy==2.4.0
pytest==9.1.1
ruff==0.17.0
types-waitress==3.0.1.20260724
watchfiles==1.3.0
```

## `bot/requirements.txt`

```text
Flask==3.1.3
groq==1.7.0
pydantic-settings==2.15.0
pyTelegramBotAPI==4.37.0
waitress==3.0.2
```

## `bot/src/bot/__init__.py`

```python

```

## `bot/src/bot/__main__.py`

```python
import argparse
import logging
import signal
import threading
from collections.abc import Sequence
from types import FrameType

from waitress.server import create_server

from bot.app import (
    build_application,
    create_assistant,
    create_telegram,
    setup_logging,
    webhook_target,
)
from bot.config import ConfigError, Settings, load_settings_or_exit
from bot.infrastructure.telegram.control import ALLOWED_UPDATES, TelegramControl


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog='python -m bot', description='Telegram bot for lab 3')
    commands = parser.add_subparsers(dest='command')
    commands.add_parser('run', help='poll Telegram for updates and serve the status page on PORT')
    webhook = commands.add_parser('webhook', help='manage the Telegram webhook')
    webhook.add_argument('action', choices=['set', 'delete', 'info'])
    commands.add_parser('check', help='check the configuration and access to Telegram and Groq')
    args = parser.parse_args(argv)

    settings = load_settings_or_exit()
    logger = setup_logging(settings)
    try:
        match args.command:
            case 'webhook':
                return manage_webhook(settings, logger, args.action)
            case 'check':
                return check(settings, logger)
            case _:
                return run(settings, logger)
    except ConfigError as error:
        logger.error(str(error))
        return 1


def run(settings: Settings, logger: logging.Logger) -> int:
    application = build_application(settings, logger=logger)
    try:
        application.control.use_polling()
        username = application.control.username()
    except Exception as error:
        logger.error('Telegram is not reachable', extra={'reason': str(error)})
        return 1
    application.control.publish_commands()

    server = create_server(
        application.web('polling'), listen=f'localhost:{settings.port}', threads=2
    )
    threading.Thread(target=server.run, name='status-page', daemon=True).start()
    signal.signal(signal.SIGINT, signal.default_int_handler)
    signal.signal(signal.SIGTERM, _interrupt)
    logger.info(
        'Bot is running',
        extra={
            'environment': settings.app_env,
            'bot': f'https://t.me/{username}',
            'status_page': f'http://localhost:{settings.port}',
            'model': settings.groq_model,
        },
    )
    try:
        application.telegram.infinity_polling(
            timeout=30, long_polling_timeout=20, allowed_updates=ALLOWED_UPDATES
        )
    finally:
        server.close()
        logger.info('Bot stopped')
    return 0


def manage_webhook(settings: Settings, logger: logging.Logger, action: str) -> int:
    control = TelegramControl(create_telegram(settings), logger)
    if action == 'set':
        target = webhook_target(settings)
        control.use_webhook(target.url, target.secret)
    elif action == 'delete':
        control.remove_webhook()
    state = control.webhook()
    logger.info(
        'Webhook state',
        extra={
            'url': state.url or '(none)',
            'pending_updates': state.pending_updates,
            'last_error': state.last_error or '(none)',
        },
    )
    return 0


def check(settings: Settings, logger: logging.Logger) -> int:
    healthy = True
    control = TelegramControl(create_telegram(settings), logger)
    try:
        logger.info('Telegram is reachable', extra={'bot': f'@{control.username()}'})
    except Exception as error:
        healthy = False
        logger.error('Telegram check failed', extra={'reason': str(error)})
    try:
        model = create_assistant(settings).check_model()
        logger.info('Groq is reachable', extra={'model': model})
    except Exception as error:
        healthy = False
        logger.error('Groq check failed', extra={'reason': str(error)})
    if healthy and settings.webhook_url:
        state = control.webhook()
        registered = state.url == settings.webhook_url
        log = logger.info if registered else logger.warning
        log(
            'Webhook is registered' if registered else 'Webhook is not registered',
            extra={'expected': settings.webhook_url, 'actual': state.url or '(none)'},
        )
    return 0 if healthy else 1


def _interrupt(_signal: int, _frame: FrameType | None) -> None:
    raise KeyboardInterrupt


if __name__ == '__main__':
    raise SystemExit(main())
```

## `bot/src/bot/app.py`

```python
import logging
from dataclasses import dataclass

from flask import Flask
from groq import Groq
from telebot import TeleBot

from bot.application.bot_service import AiPolicy, BotService
from bot.application.ports import AiAssistant
from bot.config import ConfigError, Settings, load_settings
from bot.domain.student import Contacts, Student
from bot.infrastructure.groq_assistant import GroqAssistant
from bot.infrastructure.logging_setup import configure_logging
from bot.infrastructure.sqlite_store import (
    SqliteConversationRepository,
    SqliteDatabase,
    SqliteUpdateJournal,
)
from bot.infrastructure.telegram.control import TelegramControl
from bot.infrastructure.telegram.handlers import register_handlers
from bot.infrastructure.telegram.output import TelegramChatOutput
from bot.infrastructure.telegram.webhook import WebhookReceiver
from bot.infrastructure.web.server import create_web_app
from bot.infrastructure.web.status import Mode, StatusReporter


@dataclass(frozen=True, slots=True)
class WebhookTarget:
    url: str
    secret: str


@dataclass(frozen=True, slots=True)
class Application:
    settings: Settings
    logger: logging.Logger
    telegram: TeleBot
    control: TelegramControl
    service: BotService
    journal: SqliteUpdateJournal
    student: Student

    def web(self, mode: Mode) -> Flask:
        status = StatusReporter(
            self.control,
            mode=mode,
            model=self.settings.groq_model,
            expected_webhook=self.settings.webhook_url,
            logger=self.logger,
        )
        receiver = None
        if mode == 'webhook':
            target = webhook_target(self.settings)
            receiver = WebhookReceiver(self.telegram, self.journal, target.secret, self.logger)
        return create_web_app(
            status=status, student=self.student, webhook=receiver, logger=self.logger
        )


def setup_logging(settings: Settings) -> logging.Logger:
    secrets = [settings.telegram_bot_token, settings.groq_api_key, settings.webhook_secret]
    return configure_logging(
        level=settings.log_level,
        log_format=settings.log_format,
        secrets=[secret.get_secret_value() for secret in secrets if secret is not None],
    )


def webhook_target(settings: Settings) -> WebhookTarget:
    if settings.webhook_url is None or settings.webhook_secret is None:
        raise ConfigError('WEBHOOK_BASE_URL and WEBHOOK_SECRET are required to use a webhook')
    return WebhookTarget(
        url=settings.webhook_url, secret=settings.webhook_secret.get_secret_value()
    )


def create_telegram(settings: Settings) -> TeleBot:
    return TeleBot(settings.telegram_bot_token.get_secret_value(), threaded=False)


def create_assistant(settings: Settings) -> GroqAssistant:
    client = Groq(
        api_key=settings.groq_api_key.get_secret_value(),
        timeout=settings.groq_timeout_seconds,
        max_retries=1,
    )
    return GroqAssistant(
        client=client,
        model=settings.groq_model,
        reasoning_effort=settings.groq_reasoning_effort,
        max_answer_tokens=settings.ai_max_answer_tokens,
    )


def build_application(
    settings: Settings,
    *,
    logger: logging.Logger,
    telegram: TeleBot | None = None,
    assistant: AiAssistant | None = None,
) -> Application:
    telegram = telegram or create_telegram(settings)
    database = SqliteDatabase(settings.database_file)
    output = TelegramChatOutput(telegram, logger)
    student = Student(
        full_name=settings.student_name,
        group=settings.student_group,
        variant=settings.student_variant,
        university=settings.student_university,
    )
    contacts = Contacts(
        phone=settings.contact_phone,
        email=settings.contact_email,
        telegram=settings.contact_telegram,
        github=str(settings.contact_github) if settings.contact_github else None,
    )
    service = BotService(
        student=student,
        contacts=contacts,
        assistant=assistant or create_assistant(settings),
        conversations=SqliteConversationRepository(database),
        output=output,
        policy=AiPolicy(
            model=settings.groq_model,
            history_messages=settings.ai_history_messages,
            history_chars=settings.ai_history_chars,
            max_prompt_chars=settings.ai_max_prompt_chars,
        ),
        logger=logger,
    )
    register_handlers(telegram, service, output, logger)
    return Application(
        settings=settings,
        logger=logger,
        telegram=telegram,
        control=TelegramControl(telegram, logger),
        service=service,
        journal=SqliteUpdateJournal(database),
        student=student,
    )


def create_webhook_app() -> Flask:
    settings = load_settings()
    logger = setup_logging(settings)
    target = webhook_target(settings)
    application = build_application(settings, logger=logger)
    application.control.publish_commands()
    try:
        application.control.use_webhook(target.url, target.secret)
    except Exception:
        logger.exception('Webhook registration failed, updates will not arrive until it succeeds')
    logger.info(
        'Webhook app ready',
        extra={
            'environment': settings.app_env,
            'webhook': target.url,
            'model': settings.groq_model,
        },
    )
    return application.web('webhook')
```

## `bot/src/bot/application/__init__.py`

```python

```

## `bot/src/bot/application/bot_service.py`

```python
import logging
import time
from dataclasses import dataclass

from bot.application import texts
from bot.application.errors import AiError
from bot.application.menu import (
    EXAMPLE_PREFIX,
    EXAMPLE_PROMPTS,
    MAIN_MENU,
    RESET_CONVERSATION,
    TECHNOLOGY_LIST,
    TECHNOLOGY_PREFIX,
    Command,
    MenuItem,
    back_to_technologies_keyboard,
    prompt_keyboard,
    technologies_keyboard,
)
from bot.application.ports import AiAssistant, ChatOutput, ConversationRepository
from bot.application.prompts import system_prompt
from bot.application.replies import Reply, TextFormat
from bot.domain.conversation import ChatMessage, Role, recent_context
from bot.domain.student import Contacts, Student
from bot.domain.technologies import find_technology


@dataclass(frozen=True, slots=True)
class AiPolicy:
    model: str
    history_messages: int
    history_chars: int
    max_prompt_chars: int


@dataclass(frozen=True, slots=True)
class IncomingCommand:
    chat_id: int
    command: str
    first_name: str | None = None


@dataclass(frozen=True, slots=True)
class IncomingText:
    chat_id: int
    text: str


@dataclass(frozen=True, slots=True)
class IncomingCallback:
    chat_id: int
    message_id: int
    callback_id: str
    data: str


class BotService:
    def __init__(
        self,
        *,
        student: Student,
        contacts: Contacts,
        assistant: AiAssistant,
        conversations: ConversationRepository,
        output: ChatOutput,
        policy: AiPolicy,
        logger: logging.Logger,
    ) -> None:
        self._student = student
        self._contacts = contacts
        self._assistant = assistant
        self._conversations = conversations
        self._output = output
        self._policy = policy
        self._logger = logger
        self._instructions = system_prompt(student)

    def handle_command(self, incoming: IncomingCommand) -> None:
        chat_id = incoming.chat_id
        match incoming.command:
            case Command.START:
                self._output.send(
                    chat_id, Reply(texts.welcome(incoming.first_name), keyboard=MAIN_MENU)
                )
            case Command.MENU:
                self._output.send(chat_id, Reply(texts.MENU_HINT, keyboard=MAIN_MENU))
            case Command.STUDENT:
                self._show_student(chat_id)
            case Command.TECHNOLOGIES:
                self._show_technologies(chat_id)
            case Command.CONTACTS:
                self._show_contacts(chat_id)
            case Command.PROMPT_AI:
                self._show_prompt_intro(chat_id)
            case Command.NEW_CHAT:
                self._reset_conversation(chat_id)
            case Command.HELP:
                self._output.send(chat_id, Reply(texts.HELP, keyboard=MAIN_MENU))
            case _:
                self._output.send(chat_id, Reply(texts.UNKNOWN_COMMAND))

    def handle_text(self, incoming: IncomingText) -> None:
        chat_id = incoming.chat_id
        text = incoming.text.strip()
        match text:
            case MenuItem.STUDENT:
                self._show_student(chat_id)
            case MenuItem.TECHNOLOGIES:
                self._show_technologies(chat_id)
            case MenuItem.CONTACTS:
                self._show_contacts(chat_id)
            case MenuItem.PROMPT_AI:
                self._show_prompt_intro(chat_id)
            case _:
                self._ask_ai(chat_id, text)

    def handle_callback(self, incoming: IncomingCallback) -> None:
        data = incoming.data
        if data == TECHNOLOGY_LIST:
            self._output.answer_callback(incoming.callback_id)
            self._output.edit(
                incoming.chat_id,
                incoming.message_id,
                Reply(texts.TECHNOLOGIES, keyboard=technologies_keyboard()),
            )
        elif data.startswith(TECHNOLOGY_PREFIX):
            self._open_technology(incoming, data.removeprefix(TECHNOLOGY_PREFIX))
        elif data == RESET_CONVERSATION:
            self._conversations.clear(incoming.chat_id)
            self._output.answer_callback(incoming.callback_id, 'Історію очищено')
            self._output.send(incoming.chat_id, Reply(texts.CONVERSATION_RESET))
        elif data.startswith(EXAMPLE_PREFIX):
            self._ask_example(incoming, data.removeprefix(EXAMPLE_PREFIX))
        else:
            self._output.answer_callback(incoming.callback_id, texts.STALE_BUTTON)

    def handle_unsupported(self, chat_id: int) -> None:
        self._output.send(chat_id, Reply(texts.UNSUPPORTED_CONTENT))

    def _show_student(self, chat_id: int) -> None:
        self._output.send(chat_id, Reply(texts.student_card(self._student)))

    def _show_technologies(self, chat_id: int) -> None:
        self._output.send(chat_id, Reply(texts.TECHNOLOGIES, keyboard=technologies_keyboard()))

    def _show_contacts(self, chat_id: int) -> None:
        self._output.send(chat_id, Reply(texts.contacts_card(self._contacts)))

    def _show_prompt_intro(self, chat_id: int) -> None:
        intro = texts.prompt_intro(self._policy.model)
        self._output.send(chat_id, Reply(intro, keyboard=prompt_keyboard()))

    def _reset_conversation(self, chat_id: int) -> None:
        self._conversations.clear(chat_id)
        self._output.send(chat_id, Reply(texts.CONVERSATION_RESET))

    def _open_technology(self, incoming: IncomingCallback, technology_id: str) -> None:
        technology = find_technology(technology_id)
        if technology is None:
            self._output.answer_callback(incoming.callback_id, texts.STALE_BUTTON)
            return
        self._output.answer_callback(incoming.callback_id)
        self._output.edit(
            incoming.chat_id,
            incoming.message_id,
            Reply(texts.technology_card(technology), keyboard=back_to_technologies_keyboard()),
        )

    def _ask_example(self, incoming: IncomingCallback, raw_index: str) -> None:
        index = int(raw_index) if raw_index.isdecimal() else -1
        if not 0 <= index < len(EXAMPLE_PROMPTS):
            self._output.answer_callback(incoming.callback_id, texts.STALE_BUTTON)
            return
        prompt = EXAMPLE_PROMPTS[index]
        self._output.answer_callback(incoming.callback_id)
        self._output.send(incoming.chat_id, Reply(texts.prompt_echo(prompt)))
        self._ask_ai(incoming.chat_id, prompt)

    def _ask_ai(self, chat_id: int, prompt: str) -> None:
        if not prompt:
            self._output.send(chat_id, Reply(texts.MENU_HINT))
            return
        if len(prompt) > self._policy.max_prompt_chars:
            message = texts.prompt_too_long(len(prompt), self._policy.max_prompt_chars)
            self._output.send(chat_id, Reply(message))
            return

        self._output.show_typing(chat_id)
        question = ChatMessage(Role.USER, prompt)
        history = recent_context(
            self._conversations.recent(chat_id, self._policy.history_messages),
            max_messages=self._policy.history_messages,
            max_chars=self._policy.history_chars,
        )
        started = time.perf_counter()
        try:
            answer = self._assistant.answer(self._instructions, [*history, question])
        except AiError as error:
            self._logger.warning(
                'AI request failed',
                extra={'chat_id': chat_id, 'failure': error.failure.value, 'detail': str(error)},
            )
            self._output.send(chat_id, Reply(texts.AI_FAILURES[error.failure]))
            return

        self._conversations.append(chat_id, [question, ChatMessage(Role.ASSISTANT, answer.text)])
        self._logger.info(
            'AI answered',
            extra={
                'chat_id': chat_id,
                'context_messages': len(history),
                'prompt_chars': len(prompt),
                'answer_chars': len(answer.text),
                'truncated': answer.truncated,
                'duration_ms': round((time.perf_counter() - started) * 1000),
            },
        )
        text = answer.text + texts.TRUNCATED_NOTE if answer.truncated else answer.text
        self._output.send(chat_id, Reply(text, format=TextFormat.MARKDOWN))
```

## `bot/src/bot/application/errors.py`

```python
from enum import StrEnum


class AiFailure(StrEnum):
    RATE_LIMITED = 'rate_limited'
    UNAVAILABLE = 'unavailable'
    EMPTY_ANSWER = 'empty_answer'


class AiError(Exception):
    def __init__(self, failure: AiFailure, detail: str = '') -> None:
        super().__init__(detail or failure.value)
        self.failure = failure
```

## `bot/src/bot/application/menu.py`

```python
from enum import StrEnum

from bot.application.replies import InlineButton, InlineKeyboard, MenuKeyboard
from bot.domain.technologies import TECHNOLOGIES


class MenuItem(StrEnum):
    STUDENT = '👤 Студент'
    TECHNOLOGIES = '💻 IT-технології'
    CONTACTS = '📇 Контакти'
    PROMPT_AI = '🤖 Prompt AI'


class Command(StrEnum):
    START = 'start'
    MENU = 'menu'
    STUDENT = 'student'
    TECHNOLOGIES = 'tech'
    CONTACTS = 'contacts'
    PROMPT_AI = 'ai'
    NEW_CHAT = 'new'
    HELP = 'help'


BOT_COMMANDS: tuple[tuple[Command, str], ...] = (
    (Command.MENU, 'Головне меню'),
    (Command.STUDENT, 'Інформація про студента'),
    (Command.TECHNOLOGIES, 'IT-технології'),
    (Command.CONTACTS, 'Контакти'),
    (Command.PROMPT_AI, 'Запит до AI'),
    (Command.NEW_CHAT, 'Почати нову розмову з AI'),
    (Command.HELP, 'Довідка'),
)

EXAMPLE_PROMPTS: tuple[str, ...] = (
    'Поясни простими словами, що таке REST API',
    'Чим WebSocket відрізняється від HTTP?',
    'Як безпечно зберігати паролі користувачів?',
)

TECHNOLOGY_LIST = 'tech:list'
TECHNOLOGY_PREFIX = 'tech:'
RESET_CONVERSATION = 'ai:reset'
EXAMPLE_PREFIX = 'ai:example:'

MAIN_MENU = MenuKeyboard(
    rows=(
        (MenuItem.STUDENT, MenuItem.TECHNOLOGIES),
        (MenuItem.CONTACTS, MenuItem.PROMPT_AI),
    ),
    placeholder='Оберіть пункт меню або напишіть запит до AI',
)


def technologies_keyboard() -> InlineKeyboard:
    buttons = [
        InlineButton(item.title, callback_data=f'{TECHNOLOGY_PREFIX}{item.id}')
        for item in TECHNOLOGIES
    ]
    return InlineKeyboard(rows=tuple(tuple(buttons[i : i + 2]) for i in range(0, len(buttons), 2)))


def back_to_technologies_keyboard() -> InlineKeyboard:
    return InlineKeyboard(rows=((InlineButton('⬅️ До списку', callback_data=TECHNOLOGY_LIST),),))


def prompt_keyboard() -> InlineKeyboard:
    examples = tuple(
        (InlineButton(f'💡 {prompt}', callback_data=f'{EXAMPLE_PREFIX}{index}'),)
        for index, prompt in enumerate(EXAMPLE_PROMPTS)
    )
    reset = (InlineButton('🧹 Нова розмова', callback_data=RESET_CONVERSATION),)
    return InlineKeyboard(rows=(*examples, reset))
```

## `bot/src/bot/application/ports.py`

```python
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from bot.application.replies import Reply
from bot.domain.conversation import ChatMessage


@dataclass(frozen=True, slots=True)
class AiAnswer:
    text: str
    truncated: bool = False


class AiAssistant(Protocol):
    def answer(self, instructions: str, conversation: Sequence[ChatMessage]) -> AiAnswer: ...


class ConversationRepository(Protocol):
    def recent(self, chat_id: int, limit: int) -> list[ChatMessage]: ...

    def append(self, chat_id: int, messages: Sequence[ChatMessage]) -> None: ...

    def clear(self, chat_id: int) -> None: ...


class ChatOutput(Protocol):
    def send(self, chat_id: int, reply: Reply) -> None: ...

    def edit(self, chat_id: int, message_id: int, reply: Reply) -> None: ...

    def show_typing(self, chat_id: int) -> None: ...

    def answer_callback(self, callback_id: str, text: str | None = None) -> None: ...
```

## `bot/src/bot/application/prompts.py`

```python
from bot.domain.student import Student


def system_prompt(student: Student) -> str:
    return (
        'Ти — AI-помічник у навчальному Telegram-боті. '
        f'Бота створив студент {student.full_name} (група {student.group}, '
        f'{student.university}) як лабораторну роботу №3 з курсу «Основи WEB технологій». '
        'Ти не є реальною людиною й ніколи не говориш від імені реальних людей чи організацій. '
        'Відповідай мовою користувача, за замовчуванням українською. '
        'Пиши стисло й по суті, без зайвих вступів. '
        'Форматуй відповідь для Telegram: короткі абзаци, списки через дефіс, '
        '**жирний** для ключових слів, `код` і блоки коду в потрійних зворотних лапках. '
        'Не використовуй таблиці та заголовки Markdown. '
        'Якщо не знаєш відповіді, чесно про це скажи.'
    )
```

## `bot/src/bot/application/replies.py`

```python
from dataclasses import dataclass
from enum import StrEnum

CALLBACK_DATA_LIMIT = 64


class TextFormat(StrEnum):
    HTML = 'html'
    MARKDOWN = 'markdown'


@dataclass(frozen=True, slots=True)
class InlineButton:
    text: str
    callback_data: str | None = None
    url: str | None = None

    def __post_init__(self) -> None:
        if (self.callback_data is None) == (self.url is None):
            raise ValueError('An inline button needs exactly one of callback_data or url')
        if self.callback_data is not None and (
            len(self.callback_data.encode()) > CALLBACK_DATA_LIMIT
        ):
            raise ValueError(f'Callback data is longer than {CALLBACK_DATA_LIMIT} bytes')


@dataclass(frozen=True, slots=True)
class InlineKeyboard:
    rows: tuple[tuple[InlineButton, ...], ...]


@dataclass(frozen=True, slots=True)
class MenuKeyboard:
    rows: tuple[tuple[str, ...], ...]
    placeholder: str | None = None


@dataclass(frozen=True, slots=True)
class Reply:
    text: str
    format: TextFormat = TextFormat.HTML
    keyboard: InlineKeyboard | MenuKeyboard | None = None
```

## `bot/src/bot/application/texts.py`

```python
from html import escape

from bot.application.errors import AiFailure
from bot.domain.student import Contacts, Student
from bot.domain.technologies import Technology

MENU_HINT = 'Оберіть пункт меню нижче або просто напишіть запитання для AI.'

HELP = (
    '<b>Що вміє бот</b>\n\n'
    '👤 <b>Студент</b> — хто виконав роботу\n'
    '💻 <b>IT-технології</b> — технології, використані в лабораторних роботах\n'
    '📇 <b>Контакти</b> — як зв’язатися з автором\n'
    '🤖 <b>Prompt AI</b> — запит до штучного інтелекту\n\n'
    'Будь-який текст, що не є пунктом меню, бот надсилає AI й пам’ятає контекст '
    'розмови. Команда /new починає розмову з чистого аркуша.\n\n'
    'Команди: /menu /student /tech /contacts /ai /new /help'
)

TECHNOLOGIES = (
    '💻 <b>IT-технології</b>\n\n'
    'Технології, використані в лабораторних роботах курсу «Основи WEB технологій». '
    'Оберіть, щоб дізнатися більше.'
)

CONVERSATION_RESET = '🧹 Розмову з AI очищено. Можна починати нову тему.'
UNSUPPORTED_CONTENT = (
    'Я розумію лише текстові повідомлення. Оберіть пункт меню або напишіть запитання.'
)
UNKNOWN_COMMAND = 'Такої команди немає. Список команд — /help.'
STALE_BUTTON = 'Ця кнопка вже неактуальна'
UNEXPECTED_ERROR = '😵 Щось пішло не так. Спробуйте ще раз.'
TRUNCATED_NOTE = '\n\n*(відповідь скорочено через обмеження довжини)*'

AI_FAILURES: dict[AiFailure, str] = {
    AiFailure.RATE_LIMITED: '⏳ Забагато запитів до AI. Спробуйте за хвилину.',
    AiFailure.UNAVAILABLE: '⚠️ AI тимчасово недоступний. Спробуйте трохи пізніше.',
    AiFailure.EMPTY_ANSWER: (
        '🤷 AI не зміг сформулювати відповідь. Спробуйте переформулювати запит.'
    ),
}


def welcome(first_name: str | None) -> str:
    greeting = f'Привіт, {escape(first_name)}!' if first_name else 'Привіт!'
    return (
        f'{greeting} Я навчальний бот лабораторної роботи №3 з курсу '
        '«Основи WEB технологій».\n\n'
        f'{MENU_HINT}'
    )


def student_card(student: Student) -> str:
    return (
        '👤 <b>Студент</b>\n\n'
        f'<b>ПІБ:</b> {escape(student.full_name)}\n'
        f'<b>Група:</b> {escape(student.group)}\n'
        f'<b>Варіант:</b> {student.variant}\n'
        f'<b>Університет:</b> {escape(student.university)}'
    )


def contacts_card(contacts: Contacts) -> str:
    if contacts.is_empty:
        return '📇 <b>Контакти</b>\n\nКонтакти ще не додано.'
    lines = ['📇 <b>Контакти</b>', '']
    if contacts.phone:
        lines.append(f'📞 <b>Телефон:</b> {escape(contacts.phone)}')
    if contacts.email:
        lines.append(f'✉️ <b>E-mail:</b> {escape(contacts.email)}')
    if contacts.telegram:
        lines.append(f'💬 <b>Telegram:</b> {escape(contacts.telegram)}')
    if contacts.github:
        url = escape(contacts.github, quote=True)
        lines.append(f'🐙 <b>GitHub:</b> <a href="{url}">{escape(contacts.github)}</a>')
    return '\n'.join(lines)


def technology_card(technology: Technology) -> str:
    return (
        f'💻 <b>{escape(technology.title)}</b>\n\n'
        f'{escape(technology.summary)}\n\n'
        f'<i>Де використано:</i> {escape(technology.used_in)}'
    )


def prompt_intro(model: str) -> str:
    return (
        '🤖 <b>Prompt AI</b>\n\n'
        'Напишіть запитання звичайним повідомленням — відповідь згенерує модель '
        f'<code>{escape(model)}</code> через Groq. Бот пам’ятає останні повідомлення, '
        'тому можна ставити уточнювальні запитання.\n\n'
        'Або спробуйте один із прикладів:'
    )


def prompt_echo(prompt: str) -> str:
    return f'❓ <i>{escape(prompt)}</i>'


def prompt_too_long(length: int, limit: int) -> str:
    return f'✂️ Запит задовгий: {length} символів. Максимум — {limit}.'
```

## `bot/src/bot/config.py`

```python
import re
import sys
from pathlib import Path
from typing import Literal

from pydantic import Field, HttpUrl, SecretStr, ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BOT_ROOT = Path(__file__).resolve().parents[2]
WEBHOOK_PATH = '/telegram/webhook'

ReasoningEffort = Literal['none', 'default', 'low', 'medium', 'high']

TELEGRAM_TOKEN = re.compile(r'\d{5,}:[A-Za-z0-9_-]{30,}')
WEBHOOK_SECRET = re.compile(r'[A-Za-z0-9_-]{16,256}')
PHONE = re.compile(r'\+?[0-9 ()-]{7,20}')
EMAIL = re.compile(r'[^@\s]+@[^@\s]+\.[^@\s]+')
TELEGRAM_USERNAME = re.compile(r'@?[A-Za-z0-9_]{5,32}')


class ConfigError(Exception):
    pass


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BOT_ROOT / '.env',
        env_file_encoding='utf-8',
        env_ignore_empty=True,
        extra='ignore',
        frozen=True,
    )

    app_env: Literal['development', 'production'] = 'development'
    port: int = Field(default=8000, ge=1, le=65535)
    log_level: Literal['DEBUG', 'INFO', 'WARNING', 'ERROR'] = 'INFO'
    log_format: Literal['text', 'json'] = 'text'
    database_path: Path = Path('data/bot.sqlite3')

    telegram_bot_token: SecretStr
    webhook_base_url: HttpUrl | None = None
    webhook_secret: SecretStr | None = None

    groq_api_key: SecretStr
    groq_model: str = Field(default='openai/gpt-oss-120b', min_length=1)
    groq_reasoning_effort: ReasoningEffort | None = 'low'
    groq_timeout_seconds: float = Field(default=30, gt=0, le=120)
    ai_max_answer_tokens: int = Field(default=1024, ge=64, le=8192)
    ai_history_messages: int = Field(default=10, ge=0, le=50)
    ai_history_chars: int = Field(default=6000, ge=500, le=50_000)
    ai_max_prompt_chars: int = Field(default=2000, ge=100, le=4000)

    student_name: str = 'Жуков Владислав Віталійович'
    student_group: str = 'ІС-33'
    student_variant: int = Field(default=11, ge=1)
    student_university: str = 'КПІ ім. Ігоря Сікорського'

    contact_phone: str | None = None
    contact_email: str | None = None
    contact_telegram: str | None = None
    contact_github: HttpUrl | None = None

    @field_validator('log_level', mode='before')
    @classmethod
    def _upper_level(cls, value: object) -> object:
        return value.upper() if isinstance(value, str) else value

    @field_validator('groq_reasoning_effort', mode='before')
    @classmethod
    def _optional_effort(cls, value: object) -> object:
        return None if value == 'off' else value

    @field_validator('telegram_bot_token')
    @classmethod
    def _check_token(cls, value: SecretStr) -> SecretStr:
        if not TELEGRAM_TOKEN.fullmatch(value.get_secret_value()):
            raise ValueError('expected a token from @BotFather in the form 123456:ABC...')
        return value

    @field_validator('webhook_base_url')
    @classmethod
    def _check_webhook_url(cls, value: HttpUrl | None) -> HttpUrl | None:
        if value is not None and value.scheme != 'https':
            raise ValueError('Telegram delivers webhooks only over https')
        return value

    @field_validator('webhook_secret')
    @classmethod
    def _check_webhook_secret(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None and not WEBHOOK_SECRET.fullmatch(value.get_secret_value()):
            raise ValueError('use 16-256 characters: letters, digits, "_" or "-"')
        return value

    @field_validator('contact_phone')
    @classmethod
    def _check_phone(cls, value: str | None) -> str | None:
        if value is not None and not PHONE.fullmatch(value):
            raise ValueError('expected a phone number such as +380 99 123 45 67')
        return value

    @field_validator('contact_email')
    @classmethod
    def _check_email(cls, value: str | None) -> str | None:
        if value is not None and not EMAIL.fullmatch(value):
            raise ValueError('expected an e-mail address')
        return value

    @field_validator('contact_telegram')
    @classmethod
    def _check_telegram(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not TELEGRAM_USERNAME.fullmatch(value):
            raise ValueError('expected a Telegram username such as @name')
        return f'@{value.removeprefix("@")}'

    @property
    def database_file(self) -> Path:
        path = self.database_path.expanduser()
        return path if path.is_absolute() else BOT_ROOT / path

    @property
    def webhook_url(self) -> str | None:
        if self.webhook_base_url is None:
            return None
        return f'{str(self.webhook_base_url).rstrip("/")}{WEBHOOK_PATH}'


def load_settings() -> Settings:
    try:
        return Settings()
    except ValidationError as error:
        problems = [
            f'{".".join(str(part) for part in issue["loc"]).upper()}: {issue["msg"]}'
            for issue in error.errors()
        ]
        raise ConfigError('Invalid configuration:\n  ' + '\n  '.join(problems)) from None


def load_settings_or_exit() -> Settings:
    try:
        return load_settings()
    except ConfigError as error:
        print(error, file=sys.stderr)
        print(
            f'Settings are read from environment variables and {BOT_ROOT / ".env"}', file=sys.stderr
        )
        raise SystemExit(1) from None
```

## `bot/src/bot/domain/__init__.py`

```python

```

## `bot/src/bot/domain/conversation.py`

```python
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum


class Role(StrEnum):
    USER = 'user'
    ASSISTANT = 'assistant'


@dataclass(frozen=True, slots=True)
class ChatMessage:
    role: Role
    content: str


def recent_context(
    messages: Sequence[ChatMessage], *, max_messages: int, max_chars: int
) -> list[ChatMessage]:
    selected: list[ChatMessage] = []
    used = 0
    for message in reversed(messages):
        if len(selected) >= max_messages or used + len(message.content) > max_chars:
            break
        selected.append(message)
        used += len(message.content)
    selected.reverse()
    while selected and selected[0].role is not Role.USER:
        selected.pop(0)
    return selected
```

## `bot/src/bot/domain/student.py`

```python
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Student:
    full_name: str
    group: str
    variant: int
    university: str

    @property
    def short_name(self) -> str:
        surname, *names = self.full_name.split()
        initials = ''.join(f'{name[0]}.' for name in names)
        return f'{surname} {initials}' if initials else surname


@dataclass(frozen=True, slots=True)
class Contacts:
    phone: str | None = None
    email: str | None = None
    telegram: str | None = None
    github: str | None = None

    @property
    def is_empty(self) -> bool:
        return not any((self.phone, self.email, self.telegram, self.github))
```

## `bot/src/bot/domain/technologies.py`

```python
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Technology:
    id: str
    title: str
    summary: str
    used_in: str


TECHNOLOGIES: tuple[Technology, ...] = (
    Technology(
        id='node',
        title='Node.js і TypeScript',
        summary=(
            'Node.js виконує JavaScript на сервері й обробляє тисячі з’єднань '
            'завдяки неблокувальному введенню-виведенню. TypeScript додає статичну '
            'типізацію, тому більшість помилок видно ще до запуску програми.'
        ),
        used_in='сервери лабораторних робіт №1 і №2',
    ),
    Technology(
        id='angular',
        title='Angular',
        summary=(
            'Фреймворк для односторінкових вебзастосунків. Сучасні версії керують '
            'станом через сигнали, працюють без zone.js і мають вбудовані форми '
            'з валідацією.'
        ),
        used_in='клієнти лабораторних робіт №1 і №2',
    ),
    Technology(
        id='websocket',
        title='WebSocket і Socket.IO',
        summary=(
            'WebSocket тримає постійне двостороннє з’єднання, тому сервер надсилає '
            'дані миттєво, без повторних запитів клієнта. Socket.IO додає кімнати, '
            'підтвердження доставки та автоматичне перепідключення.'
        ),
        used_in='чат реального часу в лабораторній роботі №1',
    ),
    Technology(
        id='jwt',
        title='JWT',
        summary=(
            'JSON Web Token — підписаний токен із даними користувача, який клієнт '
            'передає в заголовку Authorization. Сервер перевіряє підпис і термін дії, '
            'тож не мусить зберігати сесії.'
        ),
        used_in='реєстрація та авторизація в лабораторній роботі №2',
    ),
    Technology(
        id='python',
        title='Python',
        summary=(
            'Мова з лаконічним синтаксисом і величезною кількістю бібліотек для вебу, '
            'автоматизації та роботи з даними. Анотації типів разом із mypy роблять '
            'код надійнішим.'
        ),
        used_in='цей бот: pyTelegramBotAPI, Flask, Pydantic',
    ),
    Technology(
        id='telegram',
        title='Telegram Bot API',
        summary=(
            'HTTP-інтерфейс, через який бот отримує повідомлення й надсилає відповіді. '
            'Оновлення можна забирати опитуванням (long polling) або отримувати '
            'на вебхук, а меню будуються з reply- та inline-клавіатур.'
        ),
        used_in='меню й обробка повідомлень у лабораторній роботі №3',
    ),
    Technology(
        id='llm',
        title='Генеративний AI',
        summary=(
            'Великі мовні моделі (LLM) генерують текст у відповідь на запит. '
            'Groq запускає відкриті моделі на спеціалізованих чипах, тому відповідь '
            'приходить за долі секунди.'
        ),
        used_in='пункт меню «Prompt AI» у лабораторній роботі №3',
    ),
)


def find_technology(technology_id: str) -> Technology | None:
    return next((item for item in TECHNOLOGIES if item.id == technology_id), None)
```

## `bot/src/bot/infrastructure/__init__.py`

```python

```

## `bot/src/bot/infrastructure/groq_assistant.py`

```python
from collections.abc import Sequence

import groq
from groq import Groq, omit
from groq.types.chat import ChatCompletionMessageParam

from bot.application.errors import AiError, AiFailure
from bot.application.ports import AiAnswer
from bot.config import ReasoningEffort
from bot.domain.conversation import ChatMessage, Role


class GroqAssistant:
    def __init__(
        self,
        *,
        client: Groq,
        model: str,
        reasoning_effort: ReasoningEffort | None,
        max_answer_tokens: int,
        temperature: float = 0.6,
    ) -> None:
        self._client = client
        self._model = model
        self._reasoning_effort = reasoning_effort
        self._max_answer_tokens = max_answer_tokens
        self._temperature = temperature

    def answer(self, instructions: str, conversation: Sequence[ChatMessage]) -> AiAnswer:
        try:
            completion = self._client.chat.completions.create(
                model=self._model,
                messages=_to_messages(instructions, conversation),
                max_completion_tokens=self._max_answer_tokens,
                temperature=self._temperature,
                reasoning_effort=omit if self._reasoning_effort is None else self._reasoning_effort,
            )
        except groq.RateLimitError as error:
            raise AiError(AiFailure.RATE_LIMITED, str(error)) from error
        except groq.APIError as error:
            raise AiError(AiFailure.UNAVAILABLE, str(error)) from error

        if not completion.choices:
            raise AiError(AiFailure.EMPTY_ANSWER, 'The completion has no choices')
        choice = completion.choices[0]
        text = (choice.message.content or '').strip()
        if not text:
            raise AiError(AiFailure.EMPTY_ANSWER, f'Finish reason: {choice.finish_reason}')
        return AiAnswer(text=text, truncated=choice.finish_reason == 'length')

    def check_model(self) -> str:
        available = {model.id for model in self._client.models.list().data}
        if self._model not in available:
            raise AiError(AiFailure.UNAVAILABLE, f'Model {self._model} is not available')
        return self._model


def _to_messages(
    instructions: str, conversation: Sequence[ChatMessage]
) -> list[ChatCompletionMessageParam]:
    messages: list[ChatCompletionMessageParam] = [{'role': 'system', 'content': instructions}]
    for message in conversation:
        if message.role is Role.USER:
            messages.append({'role': 'user', 'content': message.content})
        else:
            messages.append({'role': 'assistant', 'content': message.content})
    return messages
```

## `bot/src/bot/infrastructure/logging_setup.py`

```python
import json
import logging
import sys
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Literal

STANDARD_ATTRIBUTES = frozenset(vars(logging.makeLogRecord({})).keys()) | {'message', 'asctime'}
QUIET_LOGGERS = ('urllib3', 'requests', 'httpx', 'httpcore', 'groq', 'TeleBot', 'waitress')
REDACTED = '[REDACTED]'


def _extras(record: logging.LogRecord) -> dict[str, object]:
    return {key: value for key, value in vars(record).items() if key not in STANDARD_ATTRIBUTES}


class _RedactingFormatter(logging.Formatter):
    def __init__(self, secrets: Iterable[str]) -> None:
        super().__init__()
        self._secrets = tuple(secret for secret in secrets if secret)

    def format(self, record: logging.LogRecord) -> str:
        text = self.render(record)
        for secret in self._secrets:
            text = text.replace(secret, REDACTED)
        return text

    def render(self, record: logging.LogRecord) -> str:
        raise NotImplementedError


class TextFormatter(_RedactingFormatter):
    def render(self, record: logging.LogRecord) -> str:
        timestamp = datetime.fromtimestamp(record.created).strftime('%H:%M:%S')
        details = ' '.join(f'{key}={value}' for key, value in _extras(record).items())
        line = f'{timestamp} {record.levelname:<7} {record.getMessage()}'
        if details:
            line = f'{line}  {details}'
        if record.exc_info:
            line = f'{line}\n{self.formatException(record.exc_info)}'
        return line


class JsonFormatter(_RedactingFormatter):
    def render(self, record: logging.LogRecord) -> str:
        entry: dict[str, object] = {
            'time': datetime.fromtimestamp(record.created, UTC).isoformat(timespec='milliseconds'),
            'level': record.levelname.lower(),
            'logger': record.name,
            'msg': record.getMessage(),
            **_extras(record),
        }
        if record.exc_info:
            entry['error'] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False, default=str)


def configure_logging(
    *, level: str, log_format: Literal['text', 'json'], secrets: Iterable[str]
) -> logging.Logger:
    handler = logging.StreamHandler(sys.stderr)
    formatter_type = JsonFormatter if log_format == 'json' else TextFormatter
    handler.setFormatter(formatter_type(secrets))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    for name in QUIET_LOGGERS:
        quiet = logging.getLogger(name)
        quiet.handlers.clear()
        quiet.propagate = True
        quiet.setLevel(logging.WARNING)
    return logging.getLogger('bot')
```

## `bot/src/bot/infrastructure/sqlite_store.py`

```python
import sqlite3
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from bot.domain.conversation import ChatMessage, Role

SCHEMA = """
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_by_chat ON messages (chat_id, id);
CREATE TABLE IF NOT EXISTS processed_updates (
    update_id INTEGER PRIMARY KEY,
    received_at TEXT NOT NULL
);
"""


class SqliteDatabase:
    def __init__(self, path: Path) -> None:
        self._path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch(mode=0o600, exist_ok=True)
        with self.transaction() as connection:
            connection.executescript(SCHEMA)

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self._path, timeout=10)
        try:
            with connection:
                yield connection
        finally:
            connection.close()


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec='seconds')


class SqliteConversationRepository:
    def __init__(self, database: SqliteDatabase, *, keep_per_chat: int = 50) -> None:
        self._database = database
        self._keep_per_chat = keep_per_chat

    def recent(self, chat_id: int, limit: int) -> list[ChatMessage]:
        if limit <= 0:
            return []
        with self._database.transaction() as connection:
            rows = connection.execute(
                'SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?',
                (chat_id, limit),
            ).fetchall()
        return [ChatMessage(Role(role), content) for role, content in reversed(rows)]

    def append(self, chat_id: int, messages: Sequence[ChatMessage]) -> None:
        created_at = _now()
        with self._database.transaction() as connection:
            connection.executemany(
                'INSERT INTO messages (chat_id, role, content, created_at) VALUES (?, ?, ?, ?)',
                [
                    (chat_id, message.role.value, message.content, created_at)
                    for message in messages
                ],
            )
            connection.execute(
                'DELETE FROM messages WHERE chat_id = ? AND id NOT IN '
                '(SELECT id FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?)',
                (chat_id, chat_id, self._keep_per_chat),
            )

    def clear(self, chat_id: int) -> None:
        with self._database.transaction() as connection:
            connection.execute('DELETE FROM messages WHERE chat_id = ?', (chat_id,))


class SqliteUpdateJournal:
    def __init__(self, database: SqliteDatabase, *, keep: int = 1000) -> None:
        self._database = database
        self._keep = keep

    def first_seen(self, update_id: int) -> bool:
        with self._database.transaction() as connection:
            inserted = connection.execute(
                'INSERT OR IGNORE INTO processed_updates (update_id, received_at) VALUES (?, ?)',
                (update_id, _now()),
            ).rowcount
            connection.execute(
                'DELETE FROM processed_updates WHERE update_id NOT IN '
                '(SELECT update_id FROM processed_updates ORDER BY update_id DESC LIMIT ?)',
                (self._keep,),
            )
        return inserted == 1
```

## `bot/src/bot/infrastructure/telegram/__init__.py`

```python

```

## `bot/src/bot/infrastructure/telegram/control.py`

```python
import logging
from dataclasses import dataclass

from telebot import TeleBot, types

from bot.application.menu import BOT_COMMANDS

ALLOWED_UPDATES = ['message', 'callback_query']


@dataclass(frozen=True, slots=True)
class WebhookState:
    url: str
    pending_updates: int
    last_error: str | None


class TelegramControl:
    def __init__(self, bot: TeleBot, logger: logging.Logger) -> None:
        self._bot = bot
        self._logger = logger

    def username(self) -> str:
        username = self._bot.get_me().username
        if not username:
            raise RuntimeError('Telegram returned a bot without a username')
        return username

    def publish_commands(self) -> None:
        commands = [types.BotCommand(command.value, title) for command, title in BOT_COMMANDS]
        try:
            self._bot.set_my_commands(commands)
        except Exception:
            self._logger.warning('Could not publish the command menu', exc_info=True)

    def webhook(self) -> WebhookState:
        info = self._bot.get_webhook_info()
        return WebhookState(
            url=info.url or '',
            pending_updates=info.pending_update_count or 0,
            last_error=info.last_error_message or None,
        )

    def use_webhook(self, url: str, secret: str) -> None:
        self._bot.set_webhook(
            url=url,
            secret_token=secret,
            allowed_updates=ALLOWED_UPDATES,
            max_connections=1,
        )
        self._logger.info('Webhook registered', extra={'url': url})

    def use_polling(self) -> None:
        current = self.webhook().url
        if current:
            self._logger.warning(
                'Removing the webhook to receive updates by polling; '
                'reload the web app on PythonAnywhere to register it again',
                extra={'webhook': current},
            )
        self._bot.delete_webhook()

    def remove_webhook(self) -> None:
        self._bot.delete_webhook()
        self._logger.info('Webhook removed')
```

## `bot/src/bot/infrastructure/telegram/formatting.py`

````python
import re
from html import escape

CHUNK_LIMIT = 3800
FENCE = '```'

HEADING = re.compile(r'^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$')
BULLET = re.compile(r'^(\s*)[-*+]\s+(.*)$')
RULE = re.compile(r'^\s*([-*_])(\s*\1){2,}\s*$')
INLINE_CODE = re.compile(r'`([^`\n]+)`')
LINK = re.compile(r'\[([^\]\n]+)\]\((https?://[^\s)]+)\)')
BOLD = re.compile(r'\*\*(?=\S)(.+?)(?<=\S)\*\*')
ITALIC = re.compile(r'(?<![\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\w*])')
STRIKE = re.compile(r'~~(?=\S)(.+?)(?<=\S)~~')
LANGUAGE = re.compile(r'[A-Za-z0-9_+#-]{1,20}')
PLACEHOLDER = re.compile('(\\d+)')


def markdown_to_html(markdown: str) -> str:
    output: list[str] = []
    code: list[str] | None = None
    language = ''
    for line in markdown.split('\n'):
        stripped = line.strip()
        if stripped.startswith(FENCE):
            if code is None:
                code, language = [], stripped.removeprefix(FENCE).strip()
            else:
                output.append(_code_block(code, language))
                code = None
        elif code is not None:
            code.append(line)
        else:
            output.append(_format_line(line))
    if code is not None:
        output.append(_code_block(code, language))
    return '\n'.join(output)


def split_markdown(markdown: str, limit: int = CHUNK_LIMIT) -> list[str]:
    splitter = _Splitter(limit)
    for line in markdown.split('\n'):
        splitter.add(line)
    return splitter.finish()


class _Splitter:
    def __init__(self, limit: int) -> None:
        self._limit = limit
        self._chunks: list[str] = []
        self._lines: list[str] = []
        self._size = 0
        self._fresh = True
        self._open_fence: str | None = None

    def add(self, line: str) -> None:
        rest = line
        while len(rest) > self._room():
            if not self._fresh:
                self._flush()
                continue
            piece, rest = rest[: self._room()], rest[self._room() :]
            self._append(piece)
            self._flush()
        self._append(rest)
        if line.strip().startswith(FENCE):
            self._open_fence = line.strip() if self._open_fence is None else None

    def finish(self) -> list[str]:
        if not self._fresh:
            self._chunks.append('\n'.join(self._lines))
        return self._chunks or ['']

    def _room(self) -> int:
        separator = 1 if self._lines else 0
        reserve = len(FENCE) + 1 if self._open_fence is not None else 0
        return max(1, self._limit - self._size - separator - reserve)

    def _append(self, text: str) -> None:
        self._size += len(text) + (1 if self._lines else 0)
        self._lines.append(text)
        self._fresh = False

    def _flush(self) -> None:
        if self._open_fence is not None:
            self._lines.append(FENCE)
        self._chunks.append('\n'.join(self._lines))
        self._lines = [self._open_fence] if self._open_fence is not None else []
        self._size = len(self._open_fence) if self._open_fence is not None else 0
        self._fresh = True


def _code_block(lines: list[str], language: str) -> str:
    body = escape('\n'.join(lines), quote=False)
    if LANGUAGE.fullmatch(language):
        return f'<pre><code class="language-{language}">{body}</code></pre>'
    return f'<pre>{body}</pre>'


def _format_line(line: str) -> str:
    if RULE.match(line):
        return '──────────'
    if heading := HEADING.match(line):
        return f'<b>{_inline(heading.group(1))}</b>'
    if bullet := BULLET.match(line):
        return f'{bullet.group(1)}• {_inline(bullet.group(2))}'
    return _inline(line)


def _inline(text: str) -> str:
    parts = INLINE_CODE.split(text)
    return ''.join(
        f'<code>{escape(part, quote=False)}</code>' if index % 2 else _emphasis(part)
        for index, part in enumerate(parts)
    )


def _emphasis(text: str) -> str:
    links: list[str] = []

    def keep_link(match: re.Match[str]) -> str:
        label = escape(match.group(1), quote=False)
        links.append(f'<a href="{escape(match.group(2))}">{label}</a>')
        return f'{len(links) - 1}'

    text = escape(LINK.sub(keep_link, text), quote=False)
    text = BOLD.sub(r'<b>\1</b>', text)
    text = STRIKE.sub(r'<s>\1</s>', text)
    text = ITALIC.sub(r'<i>\1</i>', text)
    return PLACEHOLDER.sub(lambda match: links[int(match.group(1))], text)
````

## `bot/src/bot/infrastructure/telegram/handlers.py`

```python
import logging
from collections.abc import Callable
from contextlib import suppress

from telebot import TeleBot, types, util

from bot.application import texts
from bot.application.bot_service import (
    BotService,
    IncomingCallback,
    IncomingCommand,
    IncomingText,
)
from bot.application.ports import ChatOutput
from bot.application.replies import Reply

PRIVATE_CHATS = ['private']
NON_TEXT_CONTENT = [kind for kind in util.content_type_media if kind != 'text']

Event = types.Message | types.CallbackQuery


def register_handlers(
    bot: TeleBot, service: BotService, output: ChatOutput, logger: logging.Logger
) -> None:
    def guard[E: Event](handler: Callable[[E], None]) -> Callable[[E], None]:
        def run(event: E) -> None:
            try:
                handler(event)
            except Exception:
                logger.exception('Update handling failed')
                chat_id = _chat_id(event)
                if chat_id is not None:
                    with suppress(Exception):
                        output.send(chat_id, Reply(texts.UNEXPECTED_ERROR))

        return run

    def on_command(message: types.Message) -> None:
        sender = message.from_user
        service.handle_command(
            IncomingCommand(
                chat_id=message.chat.id,
                command=util.extract_command(message.text or '') or '',
                first_name=sender.first_name if sender else None,
            )
        )

    def on_text(message: types.Message) -> None:
        service.handle_text(IncomingText(chat_id=message.chat.id, text=message.text or ''))

    def on_other(message: types.Message) -> None:
        service.handle_unsupported(message.chat.id)

    def on_callback(query: types.CallbackQuery) -> None:
        if query.message is None or query.data is None:
            output.answer_callback(query.id, texts.STALE_BUTTON)
            return
        service.handle_callback(
            IncomingCallback(
                chat_id=query.message.chat.id,
                message_id=query.message.message_id,
                callback_id=query.id,
                data=query.data,
            )
        )

    bot.register_message_handler(
        guard(on_command), func=_is_command, content_types=['text'], chat_types=PRIVATE_CHATS
    )
    bot.register_message_handler(guard(on_text), content_types=['text'], chat_types=PRIVATE_CHATS)
    bot.register_message_handler(
        guard(on_other), content_types=NON_TEXT_CONTENT, chat_types=PRIVATE_CHATS
    )
    bot.register_callback_query_handler(guard(on_callback), func=_any)


def _is_command(message: types.Message) -> bool:
    return util.is_command(message.text or '')


def _any(_query: types.CallbackQuery) -> bool:
    return True


def _chat_id(event: Event) -> int | None:
    if isinstance(event, types.Message):
        return event.chat.id
    return event.message.chat.id if event.message else None
```

## `bot/src/bot/infrastructure/telegram/output.py`

```python
import logging
from typing import cast

from telebot import TeleBot, types
from telebot.apihelper import ApiTelegramException

from bot.application.replies import InlineKeyboard, MenuKeyboard, Reply, TextFormat
from bot.infrastructure.telegram.formatting import markdown_to_html, split_markdown

HTML = 'HTML'
NO_PREVIEW = types.LinkPreviewOptions(is_disabled=True)

Markup = types.ReplyKeyboardMarkup | types.InlineKeyboardMarkup


class TelegramChatOutput:
    def __init__(self, bot: TeleBot, logger: logging.Logger) -> None:
        self._bot = bot
        self._logger = logger

    def send(self, chat_id: int, reply: Reply) -> None:
        markup = _markup(reply.keyboard)
        if reply.format is TextFormat.HTML:
            self._send(chat_id, reply.text, HTML, markup)
            return
        chunks = split_markdown(reply.text)
        for index, chunk in enumerate(chunks):
            self._send_markdown(chat_id, chunk, markup if index == len(chunks) - 1 else None)

    def edit(self, chat_id: int, message_id: int, reply: Reply) -> None:
        if isinstance(reply.keyboard, MenuKeyboard):
            raise TypeError('Only an inline keyboard can be attached to an edited message')
        text = markdown_to_html(reply.text) if reply.format is TextFormat.MARKDOWN else reply.text
        try:
            self._bot.edit_message_text(
                text,
                chat_id=chat_id,
                message_id=message_id,
                parse_mode=HTML,
                reply_markup=_inline_markup(reply.keyboard) if reply.keyboard else None,
                link_preview_options=NO_PREVIEW,
            )
        except ApiTelegramException as error:
            if 'message is not modified' not in error.description:
                raise

    def show_typing(self, chat_id: int) -> None:
        try:
            self._bot.send_chat_action(chat_id, 'typing')
        except ApiTelegramException as error:
            self._logger.debug('Typing indicator failed', extra={'reason': error.description})

    def answer_callback(self, callback_id: str, text: str | None = None) -> None:
        try:
            self._bot.answer_callback_query(cast(int, callback_id), text)
        except ApiTelegramException as error:
            self._logger.debug('Callback answer failed', extra={'reason': error.description})

    def _send_markdown(self, chat_id: int, chunk: str, markup: Markup | None) -> None:
        try:
            self._send(chat_id, markdown_to_html(chunk), HTML, markup)
        except ApiTelegramException as error:
            if error.error_code != 400 or "can't parse entities" not in error.description:
                raise
            self._logger.warning('Sending as plain text', extra={'reason': error.description})
            self._send(chat_id, chunk, None, markup)

    def _send(self, chat_id: int, text: str, parse_mode: str | None, markup: Markup | None) -> None:
        self._bot.send_message(
            chat_id,
            text,
            parse_mode=parse_mode,
            reply_markup=markup,
            link_preview_options=NO_PREVIEW,
        )


def _markup(keyboard: InlineKeyboard | MenuKeyboard | None) -> Markup | None:
    match keyboard:
        case MenuKeyboard(rows=rows, placeholder=placeholder):
            markup = types.ReplyKeyboardMarkup(
                resize_keyboard=True, is_persistent=True, input_field_placeholder=placeholder
            )
            for row in rows:
                markup.row(*(types.KeyboardButton(label) for label in row))
            return markup
        case InlineKeyboard():
            return _inline_markup(keyboard)
        case None:
            return None


def _inline_markup(keyboard: InlineKeyboard) -> types.InlineKeyboardMarkup:
    return types.InlineKeyboardMarkup(
        keyboard=[
            [
                types.InlineKeyboardButton(
                    button.text, url=button.url, callback_data=button.callback_data
                )
                for button in row
            ]
            for row in keyboard.rows
        ]
    )
```

## `bot/src/bot/infrastructure/telegram/webhook.py`

```python
import hmac
import logging
from typing import Protocol

from telebot import TeleBot, types

WEBHOOK_AUTH_HEADER = 'X-Telegram-Bot-Api-Secret-Token'


class UpdateJournal(Protocol):
    def first_seen(self, update_id: int) -> bool: ...


class InvalidUpdateError(ValueError):
    pass


class WebhookReceiver:
    def __init__(
        self, bot: TeleBot, journal: UpdateJournal, secret: str, logger: logging.Logger
    ) -> None:
        self._bot = bot
        self._journal = journal
        self._secret = secret.encode()
        self._logger = logger

    def authorized(self, token: str | None) -> bool:
        return token is not None and hmac.compare_digest(token.encode(), self._secret)

    def receive(self, payload: object) -> None:
        if not isinstance(payload, dict) or not isinstance(payload.get('update_id'), int):
            raise InvalidUpdateError('The body is not a Telegram update')
        update_id: int = payload['update_id']
        if not self._journal.first_seen(update_id):
            self._logger.info('Duplicate update skipped', extra={'update_id': update_id})
            return
        update = types.Update.de_json(payload)
        if update is not None:
            self._bot.process_new_updates([update])
```

## `bot/src/bot/infrastructure/web/__init__.py`

```python

```

## `bot/src/bot/infrastructure/web/server.py`

```python
import logging

from flask import Flask, Response, render_template, request
from flask.typing import ResponseReturnValue

from bot.config import WEBHOOK_PATH
from bot.domain.student import Student
from bot.infrastructure.telegram.webhook import (
    WEBHOOK_AUTH_HEADER,
    InvalidUpdateError,
    WebhookReceiver,
)
from bot.infrastructure.web.status import StatusReporter

MAX_BODY_BYTES = 1024 * 1024


def create_web_app(
    *,
    status: StatusReporter,
    student: Student,
    webhook: WebhookReceiver | None,
    logger: logging.Logger,
) -> Flask:
    app = Flask(__name__)
    app.config['MAX_CONTENT_LENGTH'] = MAX_BODY_BYTES

    @app.get('/')
    def index() -> ResponseReturnValue:
        return render_template('status.html', status=status.snapshot(), student=student)

    @app.get('/health')
    def health() -> ResponseReturnValue:
        return {'status': 'ok'}

    if webhook is not None:
        receiver = webhook

        @app.post(WEBHOOK_PATH)
        def telegram_webhook() -> ResponseReturnValue:
            if not receiver.authorized(request.headers.get(WEBHOOK_AUTH_HEADER)):
                logger.warning('Rejected a webhook call with a wrong secret')
                return {'error': 'forbidden'}, 403
            try:
                receiver.receive(request.get_json(silent=True))
            except InvalidUpdateError:
                return {'error': 'invalid update'}, 400
            except Exception:
                logger.exception('Webhook update failed')
            return {'ok': True}

    @app.after_request
    def harden(response: Response) -> Response:
        response.headers.setdefault('X-Content-Type-Options', 'nosniff')
        response.headers.setdefault('Referrer-Policy', 'no-referrer')
        if request.endpoint != 'static':
            response.headers.setdefault('Cache-Control', 'no-store')
        return response

    return app
```

## `bot/src/bot/infrastructure/web/static/styles.css`

```css
:root {
  color-scheme: light dark;
  --bg: #f4f5f8;
  --surface: #ffffff;
  --surface-2: #eef0f5;
  --text: #1c1f26;
  --muted: #5f6675;
  --border: #dcdfe6;
  --accent: #3f5bd8;
  --accent-contrast: #ffffff;
  --danger: #c62828;
  --success: #2e7d32;
  --radius: 14px;
  --shadow: 0 1px 2px rgb(0 0 0 / 6%), 0 8px 24px rgb(0 0 0 / 6%);

  font-family:
    system-ui,
    -apple-system,
    'Segoe UI',
    Roboto,
    'Noto Sans',
    sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111318;
    --surface: #1a1d24;
    --surface-2: #22262f;
    --text: #e8eaf0;
    --muted: #9aa1b1;
    --border: #2e333d;
    --accent: #7b93ff;
    --accent-contrast: #0d1020;
    --danger: #ff6b6b;
    --success: #66bb6a;
    --shadow: none;
  }
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  height: 100%;
  margin: 0;
}

body {
  display: grid;
  place-items: center;
  min-height: 100dvh;
  padding: 1.5rem;
  background: var(--bg);
  color: var(--text);
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}

a {
  color: var(--accent);
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.card {
  display: grid;
  gap: 1rem;
  width: min(100%, 30rem);
  padding: 2rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.card > * {
  margin: 0;
}

.eyebrow {
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

h1 {
  margin-top: -0.75rem;
  font-size: 1.6rem;
}

.lead {
  margin-top: -0.5rem;
  color: var(--muted);
}

.state {
  justify-self: start;
  padding: 0.2rem 0.75rem;
  border-radius: 999px;
  background: var(--surface-2);
  font-size: 0.85rem;
  font-weight: 600;
}

.state::before {
  content: '';
  display: inline-block;
  width: 0.5rem;
  height: 0.5rem;
  margin-right: 0.45rem;
  border-radius: 50%;
  background: currentColor;
  vertical-align: 0.1em;
}

.state[data-state='ok'],
.ok {
  color: var(--success);
}

.state[data-state='down'],
.bad {
  color: var(--danger);
}

dl {
  display: grid;
  gap: 0.6rem;
}

dl > div {
  display: grid;
  grid-template-columns: 10rem minmax(0, 1fr);
  gap: 0.75rem;
}

dt {
  color: var(--muted);
}

dd {
  margin: 0;
  overflow-wrap: anywhere;
}

code {
  padding: 0.1rem 0.35rem;
  border-radius: 6px;
  background: var(--surface-2);
  font-size: 0.9em;
}

.button {
  justify-self: start;
  padding: 0.6rem 1.1rem;
  border-radius: 10px;
  background: var(--accent);
  color: var(--accent-contrast);
  font-weight: 600;
  text-decoration: none;
}

footer {
  padding-top: 1rem;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 0.85rem;
}

@media (max-width: 30rem) {
  .card {
    padding: 1.25rem;
  }

  dl > div {
    grid-template-columns: minmax(0, 1fr);
    gap: 0.1rem;
  }
}
```

## `bot/src/bot/infrastructure/web/status.py`

```python
import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime, tzinfo
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from bot.infrastructure.telegram.control import TelegramControl

Mode = Literal['polling', 'webhook']


def _local_zone() -> tzinfo:
    try:
        return ZoneInfo('Europe/Kyiv')
    except ZoneInfoNotFoundError:
        return UTC


@dataclass(frozen=True, slots=True)
class BotStatus:
    online: bool
    username: str | None
    mode: Mode
    model: str
    started_at: datetime
    webhook_registered: bool | None = None
    webhook_error: str | None = None
    pending_updates: int | None = None


class StatusReporter:
    def __init__(
        self,
        control: TelegramControl,
        *,
        mode: Mode,
        model: str,
        expected_webhook: str | None,
        logger: logging.Logger,
        ttl_seconds: float = 30,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._control = control
        self._mode = mode
        self._model = model
        self._expected_webhook = expected_webhook
        self._logger = logger
        self._ttl_seconds = ttl_seconds
        self._clock = clock
        self._started_at = datetime.now(_local_zone())
        self._username: str | None = None
        self._cached: tuple[float, BotStatus] | None = None
        self._lock = threading.Lock()

    def snapshot(self) -> BotStatus:
        with self._lock:
            now = self._clock()
            if self._cached is not None and now - self._cached[0] < self._ttl_seconds:
                return self._cached[1]
            status = self._collect()
            self._cached = (now, status)
            return status

    def _collect(self) -> BotStatus:
        base = BotStatus(
            online=False,
            username=self._username,
            mode=self._mode,
            model=self._model,
            started_at=self._started_at,
        )
        try:
            if self._username is None:
                self._username = self._control.username()
            webhook = self._control.webhook() if self._mode == 'webhook' else None
        except Exception:
            self._logger.warning('Telegram status check failed', exc_info=True)
            return base
        if webhook is None:
            return replace(base, online=True, username=self._username)
        return replace(
            base,
            online=True,
            username=self._username,
            webhook_registered=webhook.url == self._expected_webhook,
            webhook_error=webhook.last_error,
            pending_updates=webhook.pending_updates,
        )
```

## `bot/src/bot/infrastructure/web/templates/status.html`

```html
<!doctype html>
<html lang="uk">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Telegram-бот · Лабораторна робота №3</title>
    <link rel="stylesheet" href="{{ url_for('static', filename='styles.css') }}" />
  </head>
  <body>
    <main class="card">
      <p class="eyebrow">Лабораторна робота №3</p>
      <h1>Telegram-бот з AI</h1>
      <p class="lead">Меню з інформацією про студента та запити до штучного інтелекту.</p>

      {% if status.online %}
        <p class="state" data-state="ok">Бот працює</p>
      {% else %}
        <p class="state" data-state="down">Немає зв’язку з Telegram</p>
      {% endif %}

      <dl>
        <div>
          <dt>Бот</dt>
          <dd>
            {% if status.username %}
              <a href="https://t.me/{{ status.username }}">@{{ status.username }}</a>
            {% else %}
              —
            {% endif %}
          </dd>
        </div>
        <div>
          <dt>Режим</dt>
          <dd>{{ 'Вебхук' if status.mode == 'webhook' else 'Long polling' }}</dd>
        </div>
        {% if status.mode == 'webhook' and status.online %}
          <div>
            <dt>Вебхук</dt>
            <dd>
              {% if status.webhook_registered %}
                <span class="ok">зареєстрований</span>
              {% else %}
                <span class="bad">не зареєстрований — перезапустіть вебзастосунок</span>
              {% endif %}
              {% if status.pending_updates %} · у черзі {{ status.pending_updates }}{% endif %}
            </dd>
          </div>
          {% if status.webhook_error %}
            <div>
              <dt>Остання помилка</dt>
              <dd class="bad">{{ status.webhook_error }}</dd>
            </div>
          {% endif %}
        {% endif %}
        <div>
          <dt>AI-модель</dt>
          <dd><code>{{ status.model }}</code></dd>
        </div>
        <div>
          <dt>Запущено</dt>
          <dd>{{ status.started_at.strftime('%d.%m.%Y %H:%M') }}</dd>
        </div>
      </dl>

      {% if status.username %}
        <a class="button" href="https://t.me/{{ status.username }}">Відкрити бота в Telegram</a>
      {% endif %}

      <footer>{{ student.short_name }} · {{ student.group }} · варіант {{ student.variant }}</footer>
    </main>
  </body>
</html>
```

## `bot/src/bot/wsgi.py`

```python
from bot.app import create_webhook_app

application = create_webhook_app()
```

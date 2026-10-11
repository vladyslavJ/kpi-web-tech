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

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

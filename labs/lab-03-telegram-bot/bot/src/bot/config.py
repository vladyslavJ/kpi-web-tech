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

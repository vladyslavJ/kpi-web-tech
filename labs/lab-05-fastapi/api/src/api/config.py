import os
import re
import sys
from pathlib import Path
from typing import Literal

from pydantic import Field, ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

API_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = API_ROOT / '.env'
BODY_LIMIT_BYTES = 64 * 1024

_MONGODB_URI = re.compile(r'mongodb(\+srv)?://\S+')
_CREDENTIALS = re.compile(r'^(mongodb(?:\+srv)?://)[^@/]*@')

Environment = Literal['development', 'production', 'test']


class ConfigError(Exception):
    pass


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file_encoding='utf-8', env_ignore_empty=True, extra='ignore', frozen=True
    )

    app_env: Environment = 'development'
    host: str = Field(default='127.0.0.1', min_length=1)
    port: int = Field(default=8000, ge=0, le=65535)
    mongodb_uri: str = 'mongodb://127.0.0.1:27018/lab05'
    mongodb_timeout_ms: int = Field(default=5000, ge=500, le=60_000)
    seed_demo_data: bool | None = None
    log_level: Literal['DEBUG', 'INFO', 'WARNING', 'ERROR'] | None = None
    log_format: Literal['text', 'json'] | None = None
    static_dir: Path | None = None

    @field_validator('mongodb_uri')
    @classmethod
    def _check_uri(cls, value: str) -> str:
        if not _MONGODB_URI.fullmatch(value.strip()):
            raise ValueError('expected a mongodb:// or mongodb+srv:// connection string')
        return value.strip()

    @field_validator('log_level', mode='before')
    @classmethod
    def _upper_level(cls, value: object) -> object:
        return value.upper() if isinstance(value, str) else value

    @property
    def is_development(self) -> bool:
        return self.app_env == 'development'

    @property
    def should_seed(self) -> bool:
        return self.is_development if self.seed_demo_data is None else self.seed_demo_data

    @property
    def effective_log_level(self) -> str:
        if self.log_level is not None:
            return self.log_level
        return 'INFO' if self.app_env == 'production' else 'DEBUG'

    @property
    def effective_log_format(self) -> Literal['text', 'json']:
        if self.log_format is not None:
            return self.log_format
        return 'text' if self.is_development else 'json'

    @property
    def safe_mongodb_uri(self) -> str:
        return redact_connection_string(self.mongodb_uri)


def redact_connection_string(uri: str) -> str:
    return _CREDENTIALS.sub(r'\1***@', uri)


def load_settings() -> Settings:
    env_file = None if os.environ.get('APP_ENV') == 'production' else ENV_FILE
    try:
        return Settings(_env_file=env_file)
    except ValidationError as error:
        details = '\n'.join(
            f'  {".".join(str(part) for part in issue["loc"]).upper()}: {issue["msg"]}'
            for issue in error.errors()
        )
        raise ConfigError(f'Invalid environment configuration:\n{details}') from error


def load_settings_or_exit() -> Settings:
    try:
        return load_settings()
    except ConfigError as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from error

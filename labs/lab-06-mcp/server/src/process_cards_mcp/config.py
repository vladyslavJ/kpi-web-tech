import re
import sys
from pathlib import Path
from typing import Literal

from pydantic import Field, ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVER_ROOT = Path(__file__).resolve().parents[2]

_MONGODB_URI = re.compile(r'mongodb(\+srv)?://\S+')
_CREDENTIALS = re.compile(r'^(mongodb(?:\+srv)?://)[^@/]*@')


class ConfigError(Exception):
    pass


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=SERVER_ROOT / '.env',
        env_file_encoding='utf-8',
        env_ignore_empty=True,
        extra='ignore',
        frozen=True,
    )

    mongodb_uri: str = 'mongodb://127.0.0.1:27018/lab05'
    mongodb_timeout_ms: int = Field(default=3000, ge=500, le=60_000)
    mcp_host: str = Field(default='127.0.0.1', min_length=1)
    mcp_port: int = Field(default=8765, ge=1, le=65535)
    log_level: Literal['DEBUG', 'INFO', 'WARNING', 'ERROR'] = 'INFO'
    log_format: Literal['text', 'json'] = 'text'

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
    def safe_mongodb_uri(self) -> str:
        return _CREDENTIALS.sub(r'\1***@', self.mongodb_uri)


def load_settings_or_exit() -> Settings:
    try:
        return Settings()
    except ValidationError as error:
        details = '\n'.join(
            f'  {".".join(str(part) for part in issue["loc"]).upper()}: {issue["msg"]}'
            for issue in error.errors()
        )
        print(f'Invalid environment configuration:\n{details}', file=sys.stderr)
        raise SystemExit(1) from error

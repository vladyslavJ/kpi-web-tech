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

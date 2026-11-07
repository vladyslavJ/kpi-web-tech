import json
import logging
import sys
from datetime import UTC, datetime
from typing import Literal

STANDARD_ATTRIBUTES = frozenset(vars(logging.makeLogRecord({})).keys()) | {
    'message',
    'asctime',
    'color_message',
    'taskName',
}
QUIET_LOGGERS = ('pymongo', 'watchfiles', 'uvicorn.access', 'httpx2', 'sse_starlette')


def _extras(record: logging.LogRecord) -> dict[str, object]:
    return {key: value for key, value in vars(record).items() if key not in STANDARD_ATTRIBUTES}


class TextFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        timestamp = datetime.fromtimestamp(record.created).strftime('%H:%M:%S')
        details = ' '.join(f'{key}={value}' for key, value in _extras(record).items())
        line = f'{timestamp} {record.levelname:<7} {record.getMessage()}'
        if details:
            line = f'{line}  {details}'
        if record.exc_info:
            line = f'{line}\n{self.formatException(record.exc_info)}'
        return line


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
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


def configure_logging(*, level: str, log_format: Literal['text', 'json']) -> None:
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(JsonFormatter() if log_format == 'json' else TextFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    for name in ('uvicorn', 'uvicorn.error', 'uvicorn.access'):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.propagate = True
    for name in QUIET_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)

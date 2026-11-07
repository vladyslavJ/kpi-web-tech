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
readonly SERVER_DIR="$ROOT/server"
readonly VENV="$SERVER_DIR/.venv"
readonly PYTHON="$VENV/bin/python"
readonly MIN_PYTHON_MINOR=12
readonly MCP_PORT="${MCP_PORT:-8765}"
readonly MONGO_PORT="${MONGO_PORT:-27018}"
export MONGO_PORT
readonly MONGO_CONTAINER=kpi-labs-mongo
readonly MONGO_WAIT_SECONDS=120
readonly STOP_TIMEOUT_SECONDS=10

if [[ -t 1 ]]; then
  readonly COLOR=1
else
  readonly COLOR=0
fi

SERVICE_PIDS=()
DATABASE_STARTED=0

usage() {
  cat <<EOF
Usage: ./run.sh <dev|prod>

  dev   development mode: the MCP server restarts on code changes, endpoint http://localhost:${MCP_PORT}/mcp
  prod  lint and type check, then the MCP server runs with production settings at http://localhost:${MCP_PORT}/mcp

Both modes start the MongoDB container ${MONGO_CONTAINER} (Docker) on port ${MONGO_PORT} if it is not running yet.
Connect LM Studio with lmstudio/mcp.json.
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
  command -v docker >/dev/null 2>&1 || fail "Docker not found, it is required to run MongoDB"
  docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin not found (docker compose)"
  docker info >/dev/null 2>&1 || fail "Docker daemon is not reachable: start Docker and check access to it"
}

port_open() {
  (exec 3<>"/dev/tcp/localhost/$1") 2>/dev/null
}

ensure_port_free() {
  if port_open "$1"; then
    fail "Port $1 is already in use: stop the process that is using it or set MCP_PORT"
  fi
}

database_running() {
  [[ "$(docker inspect --format '{{.State.Running}}' "$MONGO_CONTAINER" 2>/dev/null)" == true ]]
}

start_database() {
  if database_running; then
    info "database: container ${MONGO_CONTAINER} is already running"
  else
    ensure_port_free "$MONGO_PORT"
    info "database: starting container ${MONGO_CONTAINER} on port ${MONGO_PORT}"
    DATABASE_STARTED=1
  fi
  docker compose --file "$ROOT/compose.yaml" --progress quiet \
    up --detach --no-build --wait --wait-timeout "$MONGO_WAIT_SECONDS" mongo ||
    fail "database: container ${MONGO_CONTAINER} did not become healthy, see: docker logs ${MONGO_CONTAINER}"
  info "database: MongoDB is ready"
}

stop_database() {
  (( DATABASE_STARTED )) || return 0
  info "database: stopping container ${MONGO_CONTAINER}"
  docker compose --file "$ROOT/compose.yaml" --progress quiet stop mongo >/dev/null 2>&1 || true
  DATABASE_STARTED=0
}

install_dependencies() {
  local stamp="$VENV/.requirements.stamp"
  if [[ ! -x "$PYTHON" ]]; then
    info "server: creating a virtual environment"
    python3 -m venv "$VENV"
  fi
  if [[ ! -f "$stamp" || "$SERVER_DIR/requirements.txt" -nt "$stamp" || "$SERVER_DIR/requirements-dev.txt" -nt "$stamp" ]]; then
    info "server: installing dependencies"
    "$PYTHON" -m pip install --quiet --disable-pip-version-check -r "$SERVER_DIR/requirements-dev.txt"
    touch "$stamp"
  fi
}

check_code() {
  info "server: linting"
  (cd "$SERVER_DIR" && "$VENV/bin/ruff" check --quiet . && "$VENV/bin/ruff" format --check --quiet .)
  info "server: type checking"
  (cd "$SERVER_DIR" && "$VENV/bin/mypy")
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
    "$app" "$label" "$SERVER_DIR" "$@" </dev/null &
  SERVICE_PIDS+=("$!")
}

all_services_running() {
  local pid
  for pid in "${SERVICE_PIDS[@]}"; do
    kill -0 "$pid" 2>/dev/null || return 1
  done
}

wait_until_ready() {
  while all_services_running; do
    if port_open "$1"; then
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

cleanup() {
  trap '' INT TERM
  stop_services
  stop_database
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
  ensure_port_free "$MCP_PORT"
  install_dependencies
  if [[ "$mode" == prod ]]; then
    check_code
  fi

  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  export -f prefix_lines
  export MCP_PORT PYTHONPATH="$SERVER_DIR/src" PYTHONUNBUFFERED=1

  start_database

  if [[ "$mode" == dev ]]; then
    info "starting in development mode"
    export LOG_FORMAT=text
    start_service mcp '35' "$VENV/bin/watchfiles" --filter python --sigint-timeout 5 \
      "$(printf '%q' "$PYTHON") -m process_cards_mcp --transport http" src
  else
    info "starting in production mode"
    export LOG_FORMAT=json
    start_service mcp '35' "$PYTHON" -m process_cards_mcp --transport http
  fi

  if wait_until_ready "$MCP_PORT"; then
    info "$(paint '1;32' "Application is ready to use: http://localhost:${MCP_PORT}/mcp") (Ctrl+C to stop)"
    info "LM Studio: add the server from lmstudio/mcp.json to ~/.lmstudio/mcp.json"
  fi

  local status=0
  wait -n || status=$?
  info "a service exited with code $status, stopping the rest"
  return "$status"
}

main "$@"
```

## `compose.yaml`

```yaml
name: kpi-labs

services:
  mongo:
    image: mongo:8
    container_name: kpi-labs-mongo
    ports:
      - 127.0.0.1:${MONGO_PORT:-27018}:27017
    volumes:
      - mongo-data:/data/db
    healthcheck:
      test: ['CMD', 'mongosh', '--quiet', '--eval', 'quit(db.adminCommand({ ping: 1 }).ok ? 0 : 1)']
      interval: 5s
      timeout: 5s
      retries: 12
      start_period: 20s

volumes:
  mongo-data:
    name: kpi-labs-mongo-data
```

## `lmstudio/mcp.json`

```json
{
  "mcpServers": {
    "process-cards": {
      "url": "http://localhost:8765/mcp"
    }
  }
}
```

## `server/.env.example`

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27018/lab05
MONGODB_TIMEOUT_MS=3000

MCP_HOST=127.0.0.1
MCP_PORT=8765

LOG_LEVEL=INFO
LOG_FORMAT=text
```

## `server/pyproject.toml`

```toml
[project]
name = "lab-06-mcp"
version = "1.0.0"
description = "MCP server with read-only tools for the process cards MongoDB database"
requires-python = ">=3.12"

[tool.ruff]
line-length = 100
target-version = "py312"
src = ["src"]
extend-exclude = [".venv"]

[tool.ruff.format]
quote-style = "single"

[tool.ruff.lint]
select = ["E", "W", "F", "I", "N", "B", "UP", "SIM", "RUF", "S", "PTH", "RET", "C4", "PIE", "PL", "ASYNC"]
ignore = ["PLR2004", "PLR0913", "RUF001"]

[tool.mypy]
python_version = "3.12"
strict = true
mypy_path = "src"
packages = ["process_cards_mcp"]
plugins = ["pydantic.mypy"]
warn_unreachable = true

[tool.pytest.ini_options]
pythonpath = ["src", "../tmp/tests"]
testpaths = ["../tmp/tests"]
addopts = "-ra"
```

## `server/requirements-dev.txt`

```text
-r requirements.txt
mypy==2.4.1
pytest==9.2.0
ruff==0.17.3
watchfiles==1.3.0
```

## `server/requirements.txt`

```text
mcp==2.3.0
pydantic-settings==2.16.2
pymongo==4.19.0
uvicorn==0.54.0
```

## `server/src/process_cards_mcp/__init__.py`

```python

```

## `server/src/process_cards_mcp/__main__.py`

```python
import argparse
import logging
from typing import Literal

import anyio
import uvicorn

from process_cards_mcp.config import Settings, load_settings_or_exit
from process_cards_mcp.infrastructure.logging_setup import configure_logging
from process_cards_mcp.infrastructure.mongo_catalog import MongoCatalog
from process_cards_mcp.server import create_server

logger = logging.getLogger('process_cards_mcp')

Transport = Literal['stdio', 'http']


async def serve(settings: Settings, transport: Transport) -> None:
    catalog = MongoCatalog(settings.mongodb_uri, timeout_ms=settings.mongodb_timeout_ms)
    server = create_server(catalog)
    database = {'database': settings.safe_mongodb_uri}
    if await catalog.is_available():
        logger.info('Connected to MongoDB', extra=database)
    else:
        logger.warning(
            'MongoDB is not reachable, tools will report it until it starts', extra=database
        )
    try:
        if transport == 'stdio':
            logger.info('Serving MCP over stdio')
            await server.run_stdio_async()
        else:
            logger.info(
                'Serving MCP over Streamable HTTP',
                extra={'url': f'http://{settings.mcp_host}:{settings.mcp_port}/mcp'},
            )
            config = uvicorn.Config(
                server.streamable_http_app(),
                host=settings.mcp_host,
                port=settings.mcp_port,
                log_config=None,
                access_log=False,
                server_header=False,
            )
            await uvicorn.Server(config).serve()
    finally:
        await catalog.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        prog='python -m process_cards_mcp',
        description='MCP server with read-only tools for the process cards database',
    )
    parser.add_argument('--transport', choices=('stdio', 'http'), default='stdio')
    transport: Transport = parser.parse_args().transport
    settings = load_settings_or_exit()
    configure_logging(level=settings.log_level, log_format=settings.log_format)
    anyio.run(serve, settings, transport)


if __name__ == '__main__':
    main()
```

## `server/src/process_cards_mcp/catalog/__init__.py`

```python

```

## `server/src/process_cards_mcp/catalog/formatting.py`

```python
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

KYIV = ZoneInfo('Europe/Kyiv')
OPERATION_NUMBER_STEP = 5
_TENTHS_PER_MINUTE = 10


def round_minutes(minutes: float) -> float:
    return round(minutes * _TENTHS_PER_MINUTE) / _TENTHS_PER_MINUTE


def format_minutes(minutes: float) -> str:
    text = f'{round_minutes(minutes):.1f}'.removesuffix('.0')
    return text.replace('.', ',')


def format_duration(minutes: float) -> str:
    tenths = round(minutes * _TENTHS_PER_MINUTE)
    hours, rest = divmod(tenths, 60 * _TENTHS_PER_MINUTE)
    rest_minutes = format_minutes(rest / _TENTHS_PER_MINUTE)
    if hours == 0:
        return f'{rest_minutes} хв'
    return f'{hours} год' if rest == 0 else f'{hours} год {rest_minutes} хв'


def operation_number(index: int) -> str:
    return f'{(index + 1) * OPERATION_NUMBER_STEP:03d}'


def share_percent(part: float, whole: float) -> float:
    return round(part / whole * 100, 1) if whole > 0 else 0.0


def local_time(value: datetime) -> str:
    aware = value if value.tzinfo else value.replace(tzinfo=UTC)
    return aware.astimezone(KYIV).strftime('%Y-%m-%d %H:%M')
```

## `server/src/process_cards_mcp/catalog/models.py`

```python
from typing import Literal

from pydantic import BaseModel, Field

SortOrder = Literal['asc', 'desc']
PartSortField = Literal['designation', 'name', 'material', 'created_at']
OperationTypeSortField = Literal['name', 'operations', 'total_duration']
ProcessCardSortField = Literal['designation', 'name', 'operations', 'total_duration', 'updated_at']


class PartRow(BaseModel):
    designation: str = Field(description='Позначення (креслярський номер) деталі')
    name: str = Field(description='Найменування деталі')
    material: str | None = Field(description='Матеріал деталі')
    has_process_card: bool = Field(description='Чи є для деталі технологічна карта')


class PartList(BaseModel):
    total: int = Field(description='Кількість деталей у базі')
    sorted_by: PartSortField
    order: SortOrder
    items: list[PartRow]


class OperationTypeRow(BaseModel):
    name: str = Field(description='Назва виду обробки')
    description: str | None
    operations: int = Field(description='Скільки операцій цього виду є в усіх картах')
    total_duration_minutes: float = Field(description='Сумарна тривалість цих операцій, хв')
    total_duration: str = Field(description='Сумарна тривалість у годинах і хвилинах')


class OperationTypeList(BaseModel):
    sorted_by: OperationTypeSortField
    order: SortOrder
    items: list[OperationTypeRow]


class ProcessCardRow(BaseModel):
    designation: str = Field(description='Позначення деталі')
    part_name: str
    material: str | None
    operations: int = Field(description='Кількість операцій у маршруті')
    route: list[str] = Field(description='Види обробки в порядку виконання')
    total_duration_minutes: float
    total_duration: str
    updated_at: str = Field(description='Дата й час останньої зміни (Київ)')


class ProcessCardFilters(BaseModel):
    operation_type: str | None
    material: str | None
    min_total_minutes: float | None
    max_total_minutes: float | None


class ProcessCardList(BaseModel):
    total: int = Field(description='Кількість карт, що відповідають фільтрам')
    sorted_by: ProcessCardSortField
    order: SortOrder
    filters: ProcessCardFilters | None = Field(description='Застосовані фільтри')
    items: list[ProcessCardRow]


class OperationRow(BaseModel):
    number: str = Field(description='Номер операції: 005, 010, 015…')
    operation_type: str
    equipment: str | None
    duration_minutes: float
    share_percent: float = Field(description='Частка від сумарної тривалості карти, %')


class ProcessCardDetail(BaseModel):
    designation: str
    part_name: str
    material: str | None
    operations: list[OperationRow]
    total_duration_minutes: float
    total_duration: str
    created_at: str
    updated_at: str


class WorkloadRow(BaseModel):
    operation_type: str
    operations: int
    total_duration_minutes: float
    share_percent: float


class Overview(BaseModel):
    parts: int
    operation_types: int
    process_cards: int
    operations: int
    total_duration_minutes: float
    total_duration: str
    parts_without_card: list[str] = Field(description='Позначення деталей без технологічної карти')
    workload: list[WorkloadRow] = Field(
        description='Трудомісткість за видами обробки, від найбільшої'
    )


class OperationTypeMatch(BaseModel):
    name: str
    description: str | None


class OperationMatch(BaseModel):
    designation: str
    part_name: str
    number: str
    operation_type: str
    equipment: str | None
    duration_minutes: float


class SearchResult(BaseModel):
    query: str
    parts: list[PartRow]
    operation_types: list[OperationTypeMatch]
    operations: list[OperationMatch] = Field(
        description='Операції, у яких запит знайдено в обладнанні або назві виду обробки'
    )
```

## `server/src/process_cards_mcp/catalog/ports.py`

```python
from dataclasses import dataclass
from typing import Protocol

from process_cards_mcp.catalog.models import (
    OperationTypeList,
    OperationTypeSortField,
    Overview,
    PartList,
    PartSortField,
    ProcessCardDetail,
    ProcessCardList,
    ProcessCardSortField,
    SearchResult,
    SortOrder,
)


class CatalogUnavailableError(Exception):
    pass


class ProcessCardNotFoundError(Exception):
    def __init__(self, designation: str, *, part_exists: bool, known: list[str]) -> None:
        super().__init__(designation)
        self.designation = designation
        self.part_exists = part_exists
        self.known = known


@dataclass(frozen=True, slots=True)
class PartQuery:
    sort_by: PartSortField = 'designation'
    order: SortOrder = 'asc'
    limit: int = 50


@dataclass(frozen=True, slots=True)
class OperationTypeQuery:
    sort_by: OperationTypeSortField = 'name'
    order: SortOrder = 'asc'


@dataclass(frozen=True, slots=True)
class ProcessCardQuery:
    sort_by: ProcessCardSortField = 'designation'
    order: SortOrder = 'asc'
    limit: int = 50
    operation_type: str | None = None
    material: str | None = None
    min_total_minutes: float | None = None
    max_total_minutes: float | None = None


class CatalogReader(Protocol):
    async def overview(self) -> Overview: ...

    async def list_parts(self, query: PartQuery) -> PartList: ...

    async def list_operation_types(self, query: OperationTypeQuery) -> OperationTypeList: ...

    async def list_process_cards(self, query: ProcessCardQuery) -> ProcessCardList: ...

    async def get_process_card(self, designation: str) -> ProcessCardDetail: ...

    async def search(self, text: str, limit: int) -> SearchResult: ...

    async def is_available(self) -> bool: ...

    async def close(self) -> None: ...
```

## `server/src/process_cards_mcp/config.py`

```python
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
```

## `server/src/process_cards_mcp/infrastructure/__init__.py`

```python

```

## `server/src/process_cards_mcp/infrastructure/logging_setup.py`

```python
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
```

## `server/src/process_cards_mcp/infrastructure/mongo_catalog.py`

```python
import re
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from typing import Any

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.collation import Collation
from pymongo.errors import ConnectionFailure, PyMongoError

from process_cards_mcp.catalog.formatting import (
    format_duration,
    local_time,
    operation_number,
    round_minutes,
    share_percent,
)
from process_cards_mcp.catalog.models import (
    OperationMatch,
    OperationRow,
    OperationTypeList,
    OperationTypeMatch,
    OperationTypeRow,
    Overview,
    PartList,
    PartRow,
    ProcessCardDetail,
    ProcessCardFilters,
    ProcessCardList,
    ProcessCardRow,
    SearchResult,
    WorkloadRow,
)
from process_cards_mcp.catalog.ports import (
    CatalogUnavailableError,
    OperationTypeQuery,
    PartQuery,
    ProcessCardNotFoundError,
    ProcessCardQuery,
)

type Document = dict[str, Any]
type Pipeline = list[Document]

DEFAULT_DATABASE = 'lab05'
UKRAINIAN = Collation(locale='uk', numericOrdering=True)

PART_SORT = {
    'designation': 'designation',
    'name': 'name',
    'material': 'material',
    'created_at': 'createdAt',
}
OPERATION_TYPE_SORT = {
    'name': 'name',
    'operations': 'operations',
    'total_duration': 'total_duration_minutes',
}
PROCESS_CARD_SORT = {
    'designation': 'part.designation',
    'name': 'part.name',
    'operations': 'operations_count',
    'total_duration': 'total_duration_minutes',
    'updated_at': 'updatedAt',
}


def contains(text: str) -> Document:
    return {'$regex': re.escape(text.strip()), '$options': 'i'}


def _direction(order: str) -> int:
    return -1 if order == 'desc' else 1


def _type_name(operation: str) -> Document:
    return {
        '$getField': {
            'field': 'name',
            'input': {
                '$first': {
                    '$filter': {
                        'input': '$types',
                        'as': 'type',
                        'cond': {'$eq': ['$$type._id', f'{operation}.operationType']},
                    }
                }
            },
        }
    }


_WITH_PART_AND_TYPES: Pipeline = [
    {'$lookup': {'from': 'parts', 'localField': 'part', 'foreignField': '_id', 'as': 'part'}},
    {'$unwind': '$part'},
    {
        '$lookup': {
            'from': 'operation_types',
            'localField': 'operations.operationType',
            'foreignField': '_id',
            'as': 'types',
        }
    },
    {
        '$addFields': {
            'total_duration_minutes': {'$sum': '$operations.durationMinutes'},
            'operations_count': {'$size': '$operations'},
            'steps': {
                '$map': {
                    'input': '$operations',
                    'as': 'operation',
                    'in': {
                        'operation_type': _type_name('$$operation'),
                        'equipment': '$$operation.equipment',
                        'duration_minutes': '$$operation.durationMinutes',
                    },
                }
            },
        }
    },
]

_TYPE_USAGE: Pipeline = [
    {'$match': {'$expr': {'$in': ['$$typeId', '$operations.operationType']}}},
    {'$unwind': '$operations'},
    {'$match': {'$expr': {'$eq': ['$operations.operationType', '$$typeId']}}},
    {
        '$group': {
            '_id': None,
            'operations': {'$sum': 1},
            'minutes': {'$sum': '$operations.durationMinutes'},
        }
    },
]

_PARTS_WITH_CARD_FLAG: Pipeline = [
    {
        '$lookup': {
            'from': 'process_cards',
            'localField': '_id',
            'foreignField': 'part',
            'pipeline': [{'$project': {'_id': 1}}],
            'as': 'cards',
        }
    },
    {'$addFields': {'has_process_card': {'$gt': [{'$size': '$cards'}, 0]}}},
]


def _part_row(document: Mapping[str, Any]) -> PartRow:
    return PartRow(
        designation=document['designation'],
        name=document['name'],
        material=document.get('material'),
        has_process_card=document['has_process_card'],
    )


def _card_row(document: Mapping[str, Any]) -> ProcessCardRow:
    minutes = round_minutes(document['total_duration_minutes'])
    return ProcessCardRow(
        designation=document['part']['designation'],
        part_name=document['part']['name'],
        material=document['part'].get('material'),
        operations=document['operations_count'],
        route=[step['operation_type'] for step in document['steps']],
        total_duration_minutes=minutes,
        total_duration=format_duration(minutes),
        updated_at=local_time(document['updatedAt']),
    )


def _filters(query: ProcessCardQuery) -> ProcessCardFilters | None:
    filters = ProcessCardFilters(
        operation_type=query.operation_type,
        material=query.material,
        min_total_minutes=query.min_total_minutes,
        max_total_minutes=query.max_total_minutes,
    )
    return filters if filters.model_dump(exclude_none=True) else None


@contextmanager
def _available() -> Iterator[None]:
    try:
        yield
    except ConnectionFailure as error:
        raise CatalogUnavailableError('MongoDB is unavailable') from error


class MongoCatalog:
    def __init__(self, uri: str, *, timeout_ms: int) -> None:
        self._client: AsyncMongoClient[Document] = AsyncMongoClient(
            uri, serverSelectionTimeoutMS=timeout_ms, tz_aware=True, appname='lab-06-mcp'
        )
        self._database: AsyncDatabase[Document] = self._client.get_default_database(
            default=DEFAULT_DATABASE
        )

    @property
    def database_name(self) -> str:
        return self._database.name

    async def is_available(self) -> bool:
        try:
            await self._client.admin.command('ping')
        except PyMongoError:
            return False
        return True

    async def close(self) -> None:
        await self._client.close()

    async def overview(self) -> Overview:
        with _available():
            parts = await self._database['parts'].count_documents({})
            types = await self._database['operation_types'].count_documents({})
            cards = await self._database['process_cards'].count_documents({})
            workload = await self._aggregate(
                'process_cards',
                [
                    {'$unwind': '$operations'},
                    {
                        '$group': {
                            '_id': '$operations.operationType',
                            'operations': {'$sum': 1},
                            'minutes': {'$sum': '$operations.durationMinutes'},
                        }
                    },
                    {
                        '$lookup': {
                            'from': 'operation_types',
                            'localField': '_id',
                            'foreignField': '_id',
                            'as': 'type',
                        }
                    },
                    {'$unwind': '$type'},
                    {'$sort': {'minutes': -1, 'type.name': 1}},
                ],
            )
            without_card = await self._aggregate(
                'parts',
                [
                    *_PARTS_WITH_CARD_FLAG,
                    {'$match': {'has_process_card': False}},
                    {'$sort': {'designation': 1}},
                ],
            )

        total = round_minutes(sum(row['minutes'] for row in workload))
        return Overview(
            parts=parts,
            operation_types=types,
            process_cards=cards,
            operations=sum(row['operations'] for row in workload),
            total_duration_minutes=total,
            total_duration=format_duration(total),
            parts_without_card=[row['designation'] for row in without_card],
            workload=[
                WorkloadRow(
                    operation_type=row['type']['name'],
                    operations=row['operations'],
                    total_duration_minutes=round_minutes(row['minutes']),
                    share_percent=share_percent(row['minutes'], total),
                )
                for row in workload
            ],
        )

    async def list_parts(self, query: PartQuery) -> PartList:
        with _available():
            total = await self._database['parts'].count_documents({})
            rows = await self._aggregate(
                'parts',
                [
                    *_PARTS_WITH_CARD_FLAG,
                    {
                        '$sort': {
                            PART_SORT[query.sort_by]: _direction(query.order),
                            'designation': 1,
                        }
                    },
                    {'$limit': query.limit},
                ],
            )
        return PartList(
            total=total,
            sorted_by=query.sort_by,
            order=query.order,
            items=[_part_row(row) for row in rows],
        )

    async def list_operation_types(self, query: OperationTypeQuery) -> OperationTypeList:
        with _available():
            rows = await self._aggregate(
                'operation_types',
                [
                    {
                        '$lookup': {
                            'from': 'process_cards',
                            'let': {'typeId': '$_id'},
                            'pipeline': _TYPE_USAGE,
                            'as': 'usage',
                        }
                    },
                    {
                        '$addFields': {
                            'operations': {'$ifNull': [{'$first': '$usage.operations'}, 0]},
                            'total_duration_minutes': {
                                '$ifNull': [{'$first': '$usage.minutes'}, 0]
                            },
                        }
                    },
                    {
                        '$sort': {
                            OPERATION_TYPE_SORT[query.sort_by]: _direction(query.order),
                            'name': 1,
                        }
                    },
                ],
            )
        return OperationTypeList(
            sorted_by=query.sort_by,
            order=query.order,
            items=[
                OperationTypeRow(
                    name=row['name'],
                    description=row.get('description'),
                    operations=row['operations'],
                    total_duration_minutes=round_minutes(row['total_duration_minutes']),
                    total_duration=format_duration(row['total_duration_minutes']),
                )
                for row in rows
            ],
        )

    async def list_process_cards(self, query: ProcessCardQuery) -> ProcessCardList:
        match: Document = {}
        if query.operation_type:
            match['steps.operation_type'] = contains(query.operation_type)
        if query.material:
            match['part.material'] = contains(query.material)
        duration: Document = {}
        if query.min_total_minutes is not None:
            duration['$gte'] = query.min_total_minutes
        if query.max_total_minutes is not None:
            duration['$lte'] = query.max_total_minutes
        if duration:
            match['total_duration_minutes'] = duration

        with _available():
            [result] = await self._aggregate(
                'process_cards',
                [
                    *_WITH_PART_AND_TYPES,
                    {'$match': match},
                    {
                        '$facet': {
                            'total': [{'$count': 'value'}],
                            'items': [
                                {
                                    '$sort': {
                                        PROCESS_CARD_SORT[query.sort_by]: _direction(query.order),
                                        'part.designation': 1,
                                    }
                                },
                                {'$limit': query.limit},
                            ],
                        }
                    },
                ],
            )
        return ProcessCardList(
            total=result['total'][0]['value'] if result['total'] else 0,
            sorted_by=query.sort_by,
            order=query.order,
            filters=_filters(query),
            items=[_card_row(row) for row in result['items']],
        )

    async def get_process_card(self, designation: str) -> ProcessCardDetail:
        normalized = designation.strip().upper()
        with _available():
            rows = await self._aggregate(
                'process_cards',
                [*_WITH_PART_AND_TYPES, {'$match': {'part.designation': normalized}}],
            )
            if not rows:
                part = await self._database['parts'].find_one({'designation': normalized})
                known = await self._aggregate(
                    'process_cards',
                    [*_WITH_PART_AND_TYPES[:2], {'$sort': {'part.designation': 1}}],
                )
                raise ProcessCardNotFoundError(
                    normalized,
                    part_exists=part is not None,
                    known=[row['part']['designation'] for row in known],
                )

        [card] = rows
        total = round_minutes(card['total_duration_minutes'])
        return ProcessCardDetail(
            designation=card['part']['designation'],
            part_name=card['part']['name'],
            material=card['part'].get('material'),
            operations=[
                OperationRow(
                    number=operation_number(index),
                    operation_type=step['operation_type'],
                    equipment=step.get('equipment'),
                    duration_minutes=round_minutes(step['duration_minutes']),
                    share_percent=share_percent(step['duration_minutes'], total),
                )
                for index, step in enumerate(card['steps'])
            ],
            total_duration_minutes=total,
            total_duration=format_duration(total),
            created_at=local_time(card['createdAt']),
            updated_at=local_time(card['updatedAt']),
        )

    async def search(self, text: str, limit: int) -> SearchResult:
        pattern = contains(text)
        with _available():
            parts = await self._aggregate(
                'parts',
                [
                    {
                        '$match': {
                            '$or': [
                                {'designation': pattern},
                                {'name': pattern},
                                {'material': pattern},
                            ]
                        }
                    },
                    *_PARTS_WITH_CARD_FLAG,
                    {'$sort': {'designation': 1}},
                    {'$limit': limit},
                ],
            )
            types = await self._aggregate(
                'operation_types',
                [
                    {'$match': {'$or': [{'name': pattern}, {'description': pattern}]}},
                    {'$sort': {'name': 1}},
                    {'$limit': limit},
                ],
            )
            operations = await self._aggregate(
                'process_cards',
                [
                    *_WITH_PART_AND_TYPES,
                    {'$unwind': {'path': '$steps', 'includeArrayIndex': 'index'}},
                    {
                        '$match': {
                            '$or': [
                                {'steps.equipment': pattern},
                                {'steps.operation_type': pattern},
                            ]
                        }
                    },
                    {'$sort': {'part.designation': 1, 'index': 1}},
                    {'$limit': limit},
                ],
            )
        return SearchResult(
            query=text.strip(),
            parts=[_part_row(row) for row in parts],
            operation_types=[
                OperationTypeMatch(name=row['name'], description=row.get('description'))
                for row in types
            ],
            operations=[
                OperationMatch(
                    designation=row['part']['designation'],
                    part_name=row['part']['name'],
                    number=operation_number(row['index']),
                    operation_type=row['steps']['operation_type'],
                    equipment=row['steps'].get('equipment'),
                    duration_minutes=round_minutes(row['steps']['duration_minutes']),
                )
                for row in operations
            ],
        )

    async def _aggregate(self, collection: str, pipeline: Sequence[Document]) -> list[Document]:
        cursor = await self._database[collection].aggregate(list(pipeline), collation=UKRAINIAN)
        return [document async for document in cursor]
```

## `server/src/process_cards_mcp/server.py`

```python
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp_types import ToolAnnotations
from pydantic import Field

from process_cards_mcp.catalog.models import (
    OperationTypeList,
    OperationTypeSortField,
    Overview,
    PartList,
    PartSortField,
    ProcessCardDetail,
    ProcessCardList,
    ProcessCardSortField,
    SearchResult,
    SortOrder,
)
from process_cards_mcp.catalog.ports import (
    CatalogReader,
    CatalogUnavailableError,
    OperationTypeQuery,
    PartQuery,
    ProcessCardNotFoundError,
    ProcessCardQuery,
)

NAME = 'process-cards'
VERSION = '1.0.0'

INSTRUCTIONS = """\
Сервер дає доступ лише на читання до бази технологічних карт деталей у MongoDB.
Деталь має позначення (наприклад КПІ.301.011), найменування й матеріал. Вид обробки має назву
й опис. Технологічна карта описує маршрут обробки деталі: операції 005, 010… з видом обробки,
обладнанням і тривалістю у хвилинах.
Для загальної картини викликай get_overview. Для таблиць із сортуванням використовуй list_parts,
list_operation_types і list_process_cards з параметрами sort_by та order. Повну карту однієї
деталі дає get_process_card, а пошук за словом чи фрагментом виконує search.
Відповідай українською й не вигадуй даних, яких немає у відповідях інструментів.
"""

READ_ONLY = ToolAnnotations(readOnlyHint=True, idempotentHint=True, openWorldHint=False)

Order = Annotated[
    SortOrder, Field(description='asc — за зростанням (А→Я, менше→більше), desc — за спаданням')
]
Limit = Annotated[int, Field(ge=1, le=200, description='Скільки рядків повернути')]
Minutes = Annotated[float | None, Field(ge=0, description='Хвилини')]


@contextmanager
def _tool_errors() -> Iterator[None]:
    try:
        yield
    except CatalogUnavailableError as error:
        raise ToolError(
            'База даних MongoDB недоступна. Запустіть ./run.sh у теці лабораторної роботи 6 '
            'або контейнер kpi-labs-mongo і повторіть запит.'
        ) from error
    except ProcessCardNotFoundError as error:
        reason = (
            'деталь існує, але технологічної карти для неї ще немає'
            if error.part_exists
            else 'деталі з таким позначенням немає в базі'
        )
        known = ', '.join(error.known) or 'немає'
        raise ToolError(
            f'Технологічну карту для «{error.designation}» не знайдено: {reason}. '
            f'Карти є для деталей: {known}.'
        ) from error


def create_server(catalog: CatalogReader) -> MCPServer:
    server = MCPServer(
        NAME,
        title='Технологічні карти',
        description='Інструменти для читання, сортування й пошуку в базі технологічних карт',
        instructions=INSTRUCTIONS,
        version=VERSION,
    )

    @server.tool(
        title='Зведення по базі',
        annotations=READ_ONLY,
        description=(
            'Зведення по всій базі: кількість деталей, видів обробки, технологічних карт і '
            'операцій, сумарна трудомісткість, трудомісткість кожного виду обробки (від '
            'найбільшої) і перелік деталей, для яких ще немає технологічної карти.'
        ),
    )
    async def get_overview() -> Overview:
        with _tool_errors():
            return await catalog.overview()

    @server.tool(
        title='Деталі',
        annotations=READ_ONLY,
        description=(
            'Таблиця деталей: позначення, найменування, матеріал і наявність технологічної '
            'карти. Сортування виконує MongoDB з українським алфавітним порядком.'
        ),
    )
    async def list_parts(
        sort_by: Annotated[
            PartSortField,
            Field(
                description='Поле сортування: designation — позначення, name — найменування, '
                'material — матеріал, created_at — дата додавання'
            ),
        ] = 'designation',
        order: Order = 'asc',
        limit: Limit = 50,
    ) -> PartList:
        with _tool_errors():
            return await catalog.list_parts(PartQuery(sort_by, order, limit))

    @server.tool(
        title='Види обробки',
        annotations=READ_ONLY,
        description=(
            'Довідник видів обробки з тим, скільки разів і скільки хвилин кожен вид '
            'використовується в технологічних картах.'
        ),
    )
    async def list_operation_types(
        sort_by: Annotated[
            OperationTypeSortField,
            Field(
                description='Поле сортування: name — назва, operations — кількість операцій '
                'у картах, total_duration — сумарна тривалість цих операцій'
            ),
        ] = 'name',
        order: Order = 'asc',
    ) -> OperationTypeList:
        with _tool_errors():
            return await catalog.list_operation_types(OperationTypeQuery(sort_by, order))

    @server.tool(
        title='Технологічні карти',
        annotations=READ_ONLY,
        description=(
            'Технологічні карти з маршрутом обробки й сумарною тривалістю. Підтримує '
            'сортування та фільтри за видом обробки, матеріалом і межами сумарної тривалості '
            'у хвилинах.'
        ),
    )
    async def list_process_cards(
        *,
        sort_by: Annotated[
            ProcessCardSortField,
            Field(
                description='Поле сортування: designation — позначення деталі, name — '
                'найменування, operations — кількість операцій, total_duration — сумарна '
                'тривалість, updated_at — дата зміни'
            ),
        ] = 'designation',
        order: Order = 'asc',
        limit: Limit = 50,
        operation_type: Annotated[
            str | None,
            Field(
                max_length=60,
                description='Лише карти, що містять цей вид обробки (частина назви, '
                'без урахування регістру), наприклад «термічна»',
            ),
        ] = None,
        material: Annotated[
            str | None,
            Field(max_length=80, description='Лише деталі з цим матеріалом (частина назви)'),
        ] = None,
        min_total_minutes: Minutes = None,
        max_total_minutes: Minutes = None,
    ) -> ProcessCardList:
        query = ProcessCardQuery(
            sort_by=sort_by,
            order=order,
            limit=limit,
            operation_type=operation_type or None,
            material=material or None,
            min_total_minutes=min_total_minutes,
            max_total_minutes=max_total_minutes,
        )
        with _tool_errors():
            return await catalog.list_process_cards(query)

    @server.tool(
        title='Технологічна карта деталі',
        annotations=READ_ONLY,
        description=(
            'Повна технологічна карта однієї деталі: операції 005, 010… з видом обробки, '
            'обладнанням, тривалістю та часткою від загального часу.'
        ),
    )
    async def get_process_card(
        designation: Annotated[
            str,
            Field(
                min_length=3,
                max_length=64,
                description='Позначення деталі, наприклад КПІ.301.011 (регістр не важливий)',
            ),
        ],
    ) -> ProcessCardDetail:
        with _tool_errors():
            return await catalog.get_process_card(designation)

    @server.tool(
        title='Пошук',
        annotations=READ_ONLY,
        description=(
            'Пошук без урахування регістру в позначеннях, найменуваннях і матеріалах деталей, '
            'у назвах та описах видів обробки й в обладнанні операцій технологічних карт.'
        ),
    )
    async def search(
        query: Annotated[
            str,
            Field(
                min_length=2,
                max_length=100,
                description='Слово або фрагмент, наприклад «16К20», «сталь», «шліф»',
            ),
        ],
        limit: Annotated[
            int, Field(ge=1, le=50, description='Максимум збігів у кожній групі')
        ] = 20,
    ) -> SearchResult:
        with _tool_errors():
            return await catalog.search(query, limit)

    return server
```

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
readonly API_DIR="$ROOT/api"
readonly WEB_DIR="$ROOT/web"
readonly VENV="$API_DIR/.venv"
readonly PYTHON="$VENV/bin/python"
readonly MIN_PYTHON_MINOR=12
readonly API_PORT="${PORT:-8000}"
readonly WEB_PORT=4200
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

  dev   development mode at http://localhost:${WEB_PORT}, restarts and rebuilds on code changes
  prod  lint, type check and production build, then the server serves the client at http://localhost:${API_PORT}

Both modes start the MongoDB container ${MONGO_CONTAINER} (Docker) on port ${MONGO_PORT} if it is not running yet.
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
  command -v node >/dev/null 2>&1 || fail "Node.js not found, version 24+ is required"
  command -v npm >/dev/null 2>&1 || fail "npm not found"
  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  (( node_major >= 24 )) || fail "Node.js 24+ is required, found $(node --version)"
  command -v docker >/dev/null 2>&1 || fail "Docker not found, it is required to run MongoDB"
  docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin not found (docker compose)"
  docker info >/dev/null 2>&1 || fail "Docker daemon is not reachable: start Docker and check access to it"
}

port_open() {
  (exec 3<>"/dev/tcp/localhost/$1") 2>/dev/null
}

ensure_port_free() {
  if port_open "$1"; then
    fail "Port $1 is already in use: stop the process that is using it"
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
    info "api: creating a virtual environment"
    python3 -m venv "$VENV"
  fi
  if [[ ! -f "$stamp" || "$API_DIR/requirements.txt" -nt "$stamp" || "$API_DIR/requirements-dev.txt" -nt "$stamp" ]]; then
    info "api: installing dependencies"
    "$PYTHON" -m pip install --quiet --disable-pip-version-check -r "$API_DIR/requirements-dev.txt"
    touch "$stamp"
  fi
  if [[ ! -d "$WEB_DIR/node_modules" || "$WEB_DIR/package-lock.json" -nt "$WEB_DIR/node_modules/.package-lock.json" ]]; then
    info "web: installing dependencies"
    (cd "$WEB_DIR" && npm ci --no-audit --no-fund)
  fi
}

build_apps() {
  info "api: linting"
  (cd "$API_DIR" && "$VENV/bin/ruff" check --quiet . && "$VENV/bin/ruff" format --check --quiet .)
  info "api: type checking"
  (cd "$API_DIR" && "$VENV/bin/mypy")
  info "web: building"
  (cd "$WEB_DIR" && npm run build --no-progress)
}

prefix_lines() {
  trap '' INT TERM
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    printf '%s %s\n' "$1" "$line"
  done
}

start_service() {
  local app="$1" color="$2" dir="$3" label
  shift 3
  label="$(paint "$color" "[$app]")"
  setsid bash -c 'set -o pipefail; label="$1"; cd "$2" && shift 2 && "$@" 2>&1 | prefix_lines "$label"' \
    "$app" "$label" "$dir" "$@" </dev/null &
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
  ensure_port_free "$API_PORT"
  if [[ "$mode" == dev ]]; then
    ensure_port_free "$WEB_PORT"
  fi

  export NG_CLI_ANALYTICS=false
  if (( COLOR )); then
    export FORCE_COLOR=1
  fi

  install_dependencies
  if [[ "$mode" == prod ]]; then
    build_apps
  fi

  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  export -f prefix_lines
  export PYTHONPATH="$API_DIR/src" PYTHONUNBUFFERED=1

  start_database

  local app_port ports
  if [[ "$mode" == dev ]]; then
    info "starting in development mode"
    export APP_ENV=development
    start_service api '35' "$API_DIR" env PORT="$API_PORT" "$PYTHON" -m api
    start_service web '32' "$WEB_DIR" env -u PORT npm run dev
    app_port="$WEB_PORT"
    ports=("$API_PORT" "$WEB_PORT")
  else
    info "starting in production mode"
    export APP_ENV=production STATIC_DIR="$WEB_DIR/dist/web/browser"
    start_service api '35' "$API_DIR" env PORT="$API_PORT" "$PYTHON" -m api
    app_port="$API_PORT"
    ports=("$API_PORT")
  fi

  if wait_until_ready "${ports[@]}"; then
    info "$(paint '1;32' "Application is ready to use: http://localhost:${app_port}") (Ctrl+C to stop)"
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

## `contracts/api.contract.ts`

```typescript
export interface PartRequest {
  readonly designation: string;
  readonly name: string;
  readonly material?: string | null;
}

export interface PartDto {
  readonly id: string;
  readonly designation: string;
  readonly name: string;
  readonly material: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PartResponse {
  readonly part: PartDto;
}

export interface PartsResponse {
  readonly parts: readonly PartDto[];
}

export interface OperationTypeRequest {
  readonly name: string;
  readonly description?: string | null;
}

export interface OperationTypeDto {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OperationTypeResponse {
  readonly operationType: OperationTypeDto;
}

export interface OperationTypesResponse {
  readonly operationTypes: readonly OperationTypeDto[];
}

export interface OperationRequest {
  readonly operationTypeId: string;
  readonly equipment?: string | null;
  readonly durationMinutes: number;
}

export interface ProcessCardRequest {
  readonly partId: string;
  readonly operations: readonly OperationRequest[];
}

export interface PartRefDto {
  readonly id: string;
  readonly designation: string;
  readonly name: string;
  readonly material: string | null;
}

export interface OperationTypeRefDto {
  readonly id: string;
  readonly name: string;
}

export interface OperationDto {
  readonly number: number;
  readonly operationType: OperationTypeRefDto;
  readonly equipment: string | null;
  readonly durationMinutes: number;
}

export interface ProcessCardDto {
  readonly id: string;
  readonly part: PartRefDto;
  readonly operations: readonly OperationDto[];
  readonly totalDurationMinutes: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProcessCardResponse {
  readonly processCard: ProcessCardDto;
}

export interface ProcessCardsResponse {
  readonly processCards: readonly ProcessCardDto[];
}

export interface WorkloadDto {
  readonly operationType: OperationTypeRefDto;
  readonly operations: number;
  readonly totalDurationMinutes: number;
}

export interface StatisticsResponse {
  readonly parts: number;
  readonly operationTypes: number;
  readonly processCards: number;
  readonly operations: number;
  readonly totalDurationMinutes: number;
  readonly workload: readonly WorkloadDto[];
}

export interface HealthResponse {
  readonly status: 'ok' | 'degraded';
  readonly database: 'up' | 'down';
}

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'PART_DESIGNATION_TAKEN'
  | 'OPERATION_TYPE_NAME_TAKEN'
  | 'PART_ALREADY_HAS_CARD'
  | 'PART_IN_USE'
  | 'OPERATION_TYPE_IN_USE'
  | 'UNKNOWN_PART'
  | 'UNKNOWN_OPERATION_TYPE'
  | 'DATABASE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface ValidationIssueDto {
  readonly path: string;
  readonly message: string;
}

export interface ErrorResponse {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly issues?: readonly ValidationIssueDto[];
  };
}
```

## `api/.env.example`

```dotenv
APP_ENV=development
HOST=127.0.0.1
PORT=8000

MONGODB_URI=mongodb://127.0.0.1:27018/lab05
MONGODB_TIMEOUT_MS=5000

SEED_DEMO_DATA=true

LOG_LEVEL=DEBUG
```

## `api/pyproject.toml`

```toml
[project]
name = "lab-05-fastapi"
version = "1.0.0"
description = "FastAPI REST API with CRUD over MongoDB for technological process cards"
requires-python = ">=3.12"

[tool.ruff]
line-length = 100
target-version = "py312"
src = ["src"]
extend-exclude = [".venv"]

[tool.ruff.format]
quote-style = "single"

[tool.ruff.lint]
select = ["E", "W", "F", "I", "N", "B", "UP", "SIM", "RUF", "S", "PTH", "RET", "C4", "PIE", "PL", "ASYNC", "FAST"]
ignore = ["PLR2004", "PLR0913", "RUF001"]

[tool.ruff.lint.flake8-bugbear]
extend-immutable-calls = ["fastapi.Depends", "fastapi.Query", "fastapi.Path"]

[tool.mypy]
python_version = "3.12"
strict = true
mypy_path = "src"
packages = ["api"]
plugins = ["pydantic.mypy"]
warn_unreachable = true

[tool.pytest.ini_options]
pythonpath = ["src", "../tmp/tests/api"]
testpaths = ["../tmp/tests/api"]
addopts = "-ra"
```

## `api/requirements-dev.txt`

```text
-r requirements.txt
httpx2==2.16.0
mypy==2.4.1
pytest==9.2.0
ruff==0.17.3
```

## `api/requirements.txt`

```text
fastapi==0.162.0
pydantic-settings==2.16.2
pymongo==4.19.0
uvicorn[standard]==0.54.0
```

## `api/src/api/__init__.py`

```python

```

## `api/src/api/__main__.py`

```python
import uvicorn

from api.config import API_ROOT, load_settings_or_exit
from api.infrastructure.logging_setup import configure_logging


def main() -> None:
    settings = load_settings_or_exit()
    configure_logging(level=settings.effective_log_level, log_format=settings.effective_log_format)
    uvicorn.run(
        'api.app:create_app',
        factory=True,
        host=settings.host,
        port=settings.port,
        reload=settings.is_development,
        reload_dirs=[str(API_ROOT / 'src')] if settings.is_development else None,
        log_config=None,
        access_log=False,
        server_header=False,
        timeout_graceful_shutdown=10,
    )


if __name__ == '__main__':
    main()
```

## `api/src/api/app.py`

```python
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from api.application.errors import StorageUnavailableError
from api.application.ports import Storage
from api.application.seed_demo_data import SeedDemoData
from api.config import BODY_LIMIT_BYTES, Settings, load_settings_or_exit
from api.infrastructure.http.dependencies import Services
from api.infrastructure.http.errors import register_error_handlers
from api.infrastructure.http.middleware import install_middleware
from api.infrastructure.http.openapi import (
    DESCRIPTION,
    OPENAPI_URL,
    TAGS,
    TITLE,
    VERSION,
    DocumentedApi,
    operation_id,
)
from api.infrastructure.http.router import api_router
from api.infrastructure.http.static import ClientFiles
from api.infrastructure.logging_setup import configure_logging
from api.infrastructure.mongo.storage import MongoStorage

logger = logging.getLogger('api')


def create_app(settings: Settings | None = None, *, storage: Storage | None = None) -> FastAPI:
    config = settings or load_settings_or_exit()
    configure_logging(level=config.effective_log_level, log_format=config.effective_log_format)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        active = storage or await _connect(config)
        app.state.services = Services.build(active)
        try:
            seeded = (
                config.should_seed
                and await SeedDemoData(
                    parts=active.parts,
                    operation_types=active.operation_types,
                    process_cards=active.process_cards,
                ).execute()
            )
            logger.info(
                'Process cards API ready',
                extra={
                    'environment': config.app_env,
                    'database': config.safe_mongodb_uri,
                    'demoDataSeeded': seeded,
                    'staticDir': str(config.static_dir) if config.static_dir else None,
                },
            )
            yield
        finally:
            await active.close()
            logger.info('Server stopped')

    app = DocumentedApi(
        title=TITLE,
        version=VERSION,
        description=DESCRIPTION,
        openapi_tags=TAGS,
        openapi_url=OPENAPI_URL,
        docs_url=None,
        redoc_url=None,
        generate_unique_id_function=operation_id,
        lifespan=lifespan,
    )
    install_middleware(app, body_limit_bytes=BODY_LIMIT_BYTES)
    register_error_handlers(app)
    app.include_router(api_router())
    if config.static_dir is not None:
        app.mount('/', ClientFiles(config.static_dir), name='client')
    return app


async def _connect(settings: Settings) -> Storage:
    try:
        return await MongoStorage.connect(
            uri=settings.mongodb_uri, timeout_ms=settings.mongodb_timeout_ms
        )
    except StorageUnavailableError:
        logger.error(
            'Cannot connect to MongoDB, check that the database is running',
            extra={'database': settings.safe_mongodb_uri},
        )
        raise
```

## `api/src/api/application/__init__.py`

```python

```

## `api/src/api/application/demo_data.py`

```python
from dataclasses import dataclass

from api.domain.operation_type import OperationTypeInput
from api.domain.part import PartInput


@dataclass(frozen=True, slots=True)
class DemoOperation:
    type: str
    equipment: str | None
    duration_minutes: float


@dataclass(frozen=True, slots=True)
class DemoProcessCard:
    part: str
    operations: tuple[DemoOperation, ...]


DEMO_OPERATION_TYPES = (
    OperationTypeInput('Заготівельна', 'Відрізання заготовки з прутка, труби або листа'),
    OperationTypeInput('Токарна', 'Обробка поверхонь обертання різцями на токарному верстаті'),
    OperationTypeInput('Фрезерна', 'Обробка площин, уступів, пазів і зубів фрезами'),
    OperationTypeInput('Свердлильна', 'Свердління, зенкерування та розвертання отворів'),
    OperationTypeInput(
        'Шліфувальна',
        'Чистова обробка абразивним кругом до точного розміру й низької шорсткості',
    ),
    OperationTypeInput('Термічна', 'Гартування та відпуск для отримання потрібної твердості'),
    OperationTypeInput('Слюсарна', 'Зняття задирок і притуплення гострих кромок'),
    OperationTypeInput('Контрольна', 'Перевірка розмірів, форми та шорсткості за кресленням'),
)

DEMO_PARTS = (
    PartInput('КПІ.301.011', 'Вал ведучий', 'Сталь 45'),
    PartInput('КПІ.302.017', 'Колесо зубчасте циліндричне', 'Сталь 40Х'),
    PartInput('КПІ.305.004', 'Втулка', 'Бронза БрО10Ф1'),
    PartInput('КПІ.310.022', 'Корпус підшипника', 'Чавун СЧ20'),
    PartInput('КПІ.320.008', 'Фланець', 'Сталь 20'),
)

DEMO_PROCESS_CARDS = (
    DemoProcessCard(
        'КПІ.301.011',
        (
            DemoOperation('Заготівельна', 'Стрічкопильний верстат 8544', 2.5),
            DemoOperation('Токарна', 'Токарно-гвинторізний верстат 16К20', 18),
            DemoOperation('Фрезерна', 'Вертикально-фрезерний верстат 6Р12', 9.5),
            DemoOperation('Термічна', 'Установка СВЧ-гартування', 45),
            DemoOperation('Шліфувальна', 'Круглошліфувальний верстат 3М151', 12),
            DemoOperation('Контрольна', None, 4),
        ),
    ),
    DemoProcessCard(
        'КПІ.302.017',
        (
            DemoOperation('Заготівельна', 'Стрічкопильний верстат 8544', 3),
            DemoOperation('Токарна', 'Токарний верстат з ЧПК 16А20Ф3', 22),
            DemoOperation('Фрезерна', 'Зубофрезерний верстат 5К324', 35),
            DemoOperation('Термічна', 'Шахтна піч', 60),
            DemoOperation('Шліфувальна', 'Внутрішньошліфувальний верстат 3К228', 15),
            DemoOperation('Контрольна', None, 5),
        ),
    ),
    DemoProcessCard(
        'КПІ.305.004',
        (
            DemoOperation('Токарна', 'Токарно-револьверний верстат 1П365', 11.5),
            DemoOperation('Свердлильна', 'Вертикально-свердлильний верстат 2Н135', 4),
            DemoOperation('Слюсарна', 'Верстак слюсарний', 3),
            DemoOperation('Контрольна', None, 2),
        ),
    ),
    DemoProcessCard(
        'КПІ.310.022',
        (
            DemoOperation('Фрезерна', 'Горизонтально-фрезерний верстат 6Р82', 28),
            DemoOperation('Свердлильна', 'Радіально-свердлильний верстат 2Н55', 14),
            DemoOperation('Слюсарна', 'Верстак слюсарний', 6),
            DemoOperation('Контрольна', None, 5),
        ),
    ),
)
```

## `api/src/api/application/errors.py`

```python
from typing import Literal

type AppErrorCode = Literal[
    'NOT_FOUND',
    'PART_DESIGNATION_TAKEN',
    'OPERATION_TYPE_NAME_TAKEN',
    'PART_ALREADY_HAS_CARD',
    'PART_IN_USE',
    'OPERATION_TYPE_IN_USE',
    'UNKNOWN_PART',
    'UNKNOWN_OPERATION_TYPE',
]


class AppError(Exception):
    def __init__(self, code: AppErrorCode, message: str) -> None:
        super().__init__(message)
        self.code: AppErrorCode = code
        self.message = message


class StorageUnavailableError(Exception):
    pass
```

## `api/src/api/application/operation_types_service.py`

```python
from collections.abc import Sequence

from api.application.errors import AppError
from api.application.ports import (
    OperationTypeRepository,
    ProcessCardRepository,
    Saved,
    WriteResult,
)
from api.domain.operation_type import (
    OperationType,
    OperationTypeId,
    OperationTypeInput,
    create_operation_type_details,
)


def _not_found() -> AppError:
    return AppError('NOT_FOUND', 'Operation type not found')


class OperationTypesService:
    def __init__(
        self, *, operation_types: OperationTypeRepository, process_cards: ProcessCardRepository
    ) -> None:
        self._operation_types = operation_types
        self._process_cards = process_cards

    async def list_all(self) -> Sequence[OperationType]:
        return await self._operation_types.list_all()

    async def get(self, operation_type_id: OperationTypeId) -> OperationType:
        operation_type = await self._operation_types.find(operation_type_id)
        if operation_type is None:
            raise _not_found()
        return operation_type

    async def create(self, source: OperationTypeInput) -> OperationType:
        details = create_operation_type_details(source)
        return _saved(await self._operation_types.create(details))

    async def update(
        self, operation_type_id: OperationTypeId, source: OperationTypeInput
    ) -> OperationType:
        details = create_operation_type_details(source)
        return _saved(await self._operation_types.update(operation_type_id, details))

    async def delete(self, operation_type_id: OperationTypeId) -> None:
        if await self._process_cards.is_operation_type_used(operation_type_id):
            raise AppError(
                'OPERATION_TYPE_IN_USE',
                'The operation type is used in process cards, remove those operations first',
            )
        if not await self._operation_types.delete(operation_type_id):
            raise _not_found()


def _saved(result: WriteResult[OperationType]) -> OperationType:
    if isinstance(result, Saved):
        return result.value
    if result.reason == 'duplicate':
        raise AppError(
            'OPERATION_TYPE_NAME_TAKEN', 'An operation type with this name already exists'
        )
    raise _not_found()
```

## `api/src/api/application/parts_service.py`

```python
from collections.abc import Sequence

from api.application.errors import AppError
from api.application.ports import PartRepository, ProcessCardRepository, Saved, WriteResult
from api.domain.part import Part, PartId, PartInput, create_part_details


def _not_found() -> AppError:
    return AppError('NOT_FOUND', 'Part not found')


class PartsService:
    def __init__(self, *, parts: PartRepository, process_cards: ProcessCardRepository) -> None:
        self._parts = parts
        self._process_cards = process_cards

    async def list_all(self) -> Sequence[Part]:
        return await self._parts.list_all()

    async def get(self, part_id: PartId) -> Part:
        part = await self._parts.find(part_id)
        if part is None:
            raise _not_found()
        return part

    async def create(self, source: PartInput) -> Part:
        return _saved(await self._parts.create(create_part_details(source)))

    async def update(self, part_id: PartId, source: PartInput) -> Part:
        return _saved(await self._parts.update(part_id, create_part_details(source)))

    async def delete(self, part_id: PartId) -> None:
        if await self._process_cards.is_part_used(part_id):
            raise AppError('PART_IN_USE', 'The part has a process card, delete the card first')
        if not await self._parts.delete(part_id):
            raise _not_found()


def _saved(result: WriteResult[Part]) -> Part:
    if isinstance(result, Saved):
        return result.value
    if result.reason == 'duplicate':
        raise AppError('PART_DESIGNATION_TAKEN', 'A part with this designation already exists')
    raise _not_found()
```

## `api/src/api/application/ports.py`

```python
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

from api.domain.operation_type import OperationType, OperationTypeDetails, OperationTypeId
from api.domain.part import Part, PartDetails, PartId
from api.domain.process_card import ProcessCard, ProcessCardDetails, ProcessCardId


@dataclass(frozen=True, slots=True)
class Saved[T]:
    value: T


@dataclass(frozen=True, slots=True)
class Rejected:
    reason: Literal['duplicate', 'not-found']


type WriteResult[T] = Saved[T] | Rejected


class Repository[TEntity, TDetails, TId: str](Protocol):
    async def list_all(self) -> Sequence[TEntity]: ...

    async def count(self) -> int: ...

    async def find(self, entity_id: TId) -> TEntity | None: ...

    async def find_many(self, entity_ids: Sequence[TId]) -> Sequence[TEntity]: ...

    async def create(self, details: TDetails) -> WriteResult[TEntity]: ...

    async def update(self, entity_id: TId, details: TDetails) -> WriteResult[TEntity]: ...

    async def delete(self, entity_id: TId) -> bool: ...


class PartRepository(Repository[Part, PartDetails, PartId], Protocol):
    pass


class OperationTypeRepository(
    Repository[OperationType, OperationTypeDetails, OperationTypeId], Protocol
):
    pass


@dataclass(frozen=True, slots=True)
class OperationTypeWorkload:
    operation_type_id: OperationTypeId
    operations: int
    total_duration_minutes: float


class ProcessCardRepository(Repository[ProcessCard, ProcessCardDetails, ProcessCardId], Protocol):
    async def is_part_used(self, part_id: PartId) -> bool: ...

    async def is_operation_type_used(self, operation_type_id: OperationTypeId) -> bool: ...

    async def workload(self) -> Sequence[OperationTypeWorkload]: ...


class Storage(Protocol):
    @property
    def parts(self) -> PartRepository: ...

    @property
    def operation_types(self) -> OperationTypeRepository: ...

    @property
    def process_cards(self) -> ProcessCardRepository: ...

    async def is_available(self) -> bool: ...

    async def close(self) -> None: ...
```

## `api/src/api/application/process_cards_service.py`

```python
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from api.application.errors import AppError
from api.application.ports import (
    OperationTypeRepository,
    PartRepository,
    ProcessCardRepository,
    Saved,
    WriteResult,
)
from api.domain.operation_type import OperationType, OperationTypeId
from api.domain.part import Part
from api.domain.process_card import (
    ProcessCard,
    ProcessCardDetails,
    ProcessCardId,
    ProcessCardInput,
    create_process_card_details,
    referenced_operation_types,
)


@dataclass(frozen=True, slots=True)
class ProcessCardView:
    card: ProcessCard
    part: Part
    operation_types: Mapping[OperationTypeId, OperationType]


def _not_found() -> AppError:
    return AppError('NOT_FOUND', 'Process card not found')


class ProcessCardsService:
    def __init__(
        self,
        *,
        process_cards: ProcessCardRepository,
        parts: PartRepository,
        operation_types: OperationTypeRepository,
    ) -> None:
        self._process_cards = process_cards
        self._parts = parts
        self._operation_types = operation_types

    async def list_all(self) -> Sequence[ProcessCardView]:
        views = await self._views(await self._process_cards.list_all())
        return sorted(views, key=lambda view: view.part.designation)

    async def get(self, card_id: ProcessCardId) -> ProcessCardView:
        card = await self._process_cards.find(card_id)
        if card is None:
            raise _not_found()
        return await self._view(card)

    async def create(self, source: ProcessCardInput) -> ProcessCardView:
        details = create_process_card_details(source)
        await self._check_references(details)
        return await self._saved(await self._process_cards.create(details))

    async def update(self, card_id: ProcessCardId, source: ProcessCardInput) -> ProcessCardView:
        details = create_process_card_details(source)
        if await self._process_cards.find(card_id) is None:
            raise _not_found()
        await self._check_references(details)
        return await self._saved(await self._process_cards.update(card_id, details))

    async def delete(self, card_id: ProcessCardId) -> None:
        if not await self._process_cards.delete(card_id):
            raise _not_found()

    async def _check_references(self, details: ProcessCardDetails) -> None:
        if await self._parts.find(details.part_id) is None:
            raise AppError('UNKNOWN_PART', 'The referenced part does not exist')
        ids = referenced_operation_types(details)
        found = {operation_type.id for operation_type in await self._operation_types.find_many(ids)}
        missing = next((type_id for type_id in ids if type_id not in found), None)
        if missing is not None:
            raise AppError('UNKNOWN_OPERATION_TYPE', f'Operation type {missing} does not exist')

    async def _saved(self, result: WriteResult[ProcessCard]) -> ProcessCardView:
        if isinstance(result, Saved):
            return await self._view(result.value)
        if result.reason == 'duplicate':
            raise AppError('PART_ALREADY_HAS_CARD', 'The part already has a process card')
        raise _not_found()

    async def _view(self, card: ProcessCard) -> ProcessCardView:
        [view] = await self._views([card])
        return view

    async def _views(self, cards: Sequence[ProcessCard]) -> list[ProcessCardView]:
        part_ids = list(dict.fromkeys(card.part_id for card in cards))
        type_ids = list(
            dict.fromkeys(type_id for card in cards for type_id in referenced_operation_types(card))
        )
        parts = {part.id: part for part in await self._parts.find_many(part_ids)}
        operation_types = {
            operation_type.id: operation_type
            for operation_type in await self._operation_types.find_many(type_ids)
        }

        views: list[ProcessCardView] = []
        for card in cards:
            part = parts.get(card.part_id)
            resolved = all(
                operation.operation_type_id in operation_types for operation in card.operations
            )
            if part is None or not resolved:
                raise RuntimeError(
                    f'Process card {card.id} references a deleted part or operation type'
                )
            views.append(ProcessCardView(card, part, operation_types))
        return views
```

## `api/src/api/application/seed_demo_data.py`

```python
import asyncio
from collections.abc import Mapping

from api.application.demo_data import DEMO_OPERATION_TYPES, DEMO_PARTS, DEMO_PROCESS_CARDS
from api.application.ports import (
    OperationTypeRepository,
    PartRepository,
    ProcessCardRepository,
    Saved,
    WriteResult,
)
from api.domain.operation_type import create_operation_type_details
from api.domain.part import create_part_details
from api.domain.process_card import OperationInput, ProcessCardInput, create_process_card_details


class SeedDemoData:
    def __init__(
        self,
        *,
        parts: PartRepository,
        operation_types: OperationTypeRepository,
        process_cards: ProcessCardRepository,
    ) -> None:
        self._parts = parts
        self._operation_types = operation_types
        self._process_cards = process_cards

    async def execute(self) -> bool:
        counts = await asyncio.gather(
            self._parts.count(), self._operation_types.count(), self._process_cards.count()
        )
        if any(counts):
            return False

        type_ids: dict[str, str] = {}
        for type_input in DEMO_OPERATION_TYPES:
            type_details = create_operation_type_details(type_input)
            operation_type = _saved(await self._operation_types.create(type_details))
            type_ids[operation_type.name] = operation_type.id

        part_ids: dict[str, str] = {}
        for part_input in DEMO_PARTS:
            part = _saved(await self._parts.create(create_part_details(part_input)))
            part_ids[part.designation] = part.id

        for card in DEMO_PROCESS_CARDS:
            card_details = create_process_card_details(
                ProcessCardInput(
                    part_id=_lookup(part_ids, card.part),
                    operations=[
                        OperationInput(
                            operation_type_id=_lookup(type_ids, operation.type),
                            equipment=operation.equipment,
                            duration_minutes=operation.duration_minutes,
                        )
                        for operation in card.operations
                    ],
                )
            )
            _saved(await self._process_cards.create(card_details))
        return True


def _saved[T](result: WriteResult[T]) -> T:
    if not isinstance(result, Saved):
        raise RuntimeError(f'Demo data could not be saved: {result.reason}')
    return result.value


def _lookup(ids: Mapping[str, str], key: str) -> str:
    if key not in ids:
        raise RuntimeError(f'Demo data references an unknown record: {key}')
    return ids[key]
```

## `api/src/api/application/statistics_service.py`

```python
import asyncio
from collections.abc import Sequence
from dataclasses import dataclass

from api.application.ports import OperationTypeRepository, PartRepository, ProcessCardRepository
from api.domain.operation_type import OperationType
from api.domain.process_card import sum_durations


@dataclass(frozen=True, slots=True)
class WorkloadEntry:
    operation_type: OperationType
    operations: int
    total_duration_minutes: float


@dataclass(frozen=True, slots=True)
class Statistics:
    parts: int
    operation_types: int
    process_cards: int
    operations: int
    total_duration_minutes: float
    workload: Sequence[WorkloadEntry]


class StatisticsService:
    def __init__(
        self,
        *,
        parts: PartRepository,
        operation_types: OperationTypeRepository,
        process_cards: ProcessCardRepository,
    ) -> None:
        self._parts = parts
        self._operation_types = operation_types
        self._process_cards = process_cards

    async def collect(self) -> Statistics:
        parts, process_cards, operation_types, workload = await asyncio.gather(
            self._parts.count(),
            self._process_cards.count(),
            self._operation_types.list_all(),
            self._process_cards.workload(),
        )
        by_type = {entry.operation_type_id: entry for entry in workload}
        entries = [
            WorkloadEntry(
                operation_type=operation_type,
                operations=entry.operations if entry else 0,
                total_duration_minutes=entry.total_duration_minutes if entry else 0.0,
            )
            for operation_type in operation_types
            for entry in [by_type.get(operation_type.id)]
        ]
        entries.sort(key=lambda entry: -entry.total_duration_minutes)

        return Statistics(
            parts=parts,
            operation_types=len(operation_types),
            process_cards=process_cards,
            operations=sum(entry.operations for entry in entries),
            total_duration_minutes=sum_durations(entry.total_duration_minutes for entry in entries),
            workload=entries,
        )
```

## `api/src/api/config.py`

```python
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
```

## `api/src/api/domain/__init__.py`

```python

```

## `api/src/api/domain/errors.py`

```python
class DomainError(ValueError):
    pass
```

## `api/src/api/domain/operation_type.py`

```python
from dataclasses import dataclass
from datetime import datetime
from typing import NewType

from api.domain.text import Limits, assert_length, normalize_text, optional_text

OperationTypeId = NewType('OperationTypeId', str)

OPERATION_TYPE_NAME_LENGTH = Limits(2, 60)
OPERATION_TYPE_DESCRIPTION_LENGTH = Limits(1, 300)


@dataclass(frozen=True, slots=True)
class OperationTypeInput:
    name: str
    description: str | None = None


@dataclass(frozen=True, slots=True)
class OperationTypeDetails:
    name: str
    description: str | None


@dataclass(frozen=True, slots=True)
class OperationType(OperationTypeDetails):
    id: OperationTypeId
    created_at: datetime
    updated_at: datetime


def normalize_operation_type_name(raw: str) -> str:
    name = normalize_text(raw)
    return name[:1].upper() + name[1:]


def create_operation_type_details(source: OperationTypeInput) -> OperationTypeDetails:
    name = normalize_operation_type_name(source.name)
    assert_length('Operation type name', name, OPERATION_TYPE_NAME_LENGTH)
    description = optional_text(source.description)
    if description is not None:
        assert_length('Operation type description', description, OPERATION_TYPE_DESCRIPTION_LENGTH)
    return OperationTypeDetails(name, description)
```

## `api/src/api/domain/part.py`

```python
import re
from dataclasses import dataclass
from datetime import datetime
from typing import NewType

from api.domain.errors import DomainError
from api.domain.text import Limits, assert_length, normalize_text, optional_text

PartId = NewType('PartId', str)

PART_DESIGNATION_PATTERN = re.compile(r'[^\W_](?:[^\W_]|[./-]){1,38}[^\W_]')
PART_DESIGNATION_LENGTH = Limits(3, 40)
PART_NAME_LENGTH = Limits(2, 120)
PART_MATERIAL_LENGTH = Limits(1, 80)


@dataclass(frozen=True, slots=True)
class PartInput:
    designation: str
    name: str
    material: str | None = None


@dataclass(frozen=True, slots=True)
class PartDetails:
    designation: str
    name: str
    material: str | None


@dataclass(frozen=True, slots=True)
class Part(PartDetails):
    id: PartId
    created_at: datetime
    updated_at: datetime


def normalize_designation(raw: str) -> str:
    return raw.strip().upper()


def is_valid_designation(raw: str) -> bool:
    return PART_DESIGNATION_PATTERN.fullmatch(normalize_designation(raw)) is not None


def create_part_details(source: PartInput) -> PartDetails:
    if not is_valid_designation(source.designation):
        raise DomainError(f'Invalid part designation: {source.designation!r}')
    name = normalize_text(source.name)
    assert_length('Part name', name, PART_NAME_LENGTH)
    material = optional_text(source.material)
    if material is not None:
        assert_length('Part material', material, PART_MATERIAL_LENGTH)
    return PartDetails(normalize_designation(source.designation), name, material)
```

## `api/src/api/domain/process_card.py`

```python
import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import NewType

from api.domain.errors import DomainError
from api.domain.operation_type import OperationTypeId
from api.domain.part import PartId
from api.domain.text import Limits, assert_length, optional_text

ProcessCardId = NewType('ProcessCardId', str)

OPERATIONS_COUNT = Limits(1, 30)
DURATION_MIN_MINUTES = 0.1
DURATION_MAX_MINUTES = 1440.0
EQUIPMENT_LENGTH = Limits(1, 120)
OPERATION_NUMBER_STEP = 5

_TENTHS_PER_MINUTE = 10


@dataclass(frozen=True, slots=True)
class OperationInput:
    operation_type_id: str
    duration_minutes: float
    equipment: str | None = None


@dataclass(frozen=True, slots=True)
class ProcessCardInput:
    part_id: str
    operations: Sequence[OperationInput]


@dataclass(frozen=True, slots=True)
class Operation:
    operation_type_id: OperationTypeId
    equipment: str | None
    duration_minutes: float


@dataclass(frozen=True, slots=True)
class ProcessCardDetails:
    part_id: PartId
    operations: tuple[Operation, ...]


@dataclass(frozen=True, slots=True)
class ProcessCard(ProcessCardDetails):
    id: ProcessCardId
    created_at: datetime
    updated_at: datetime


def is_valid_duration(minutes: float) -> bool:
    if isinstance(minutes, bool) or not math.isfinite(minutes):
        return False
    tenths = minutes * _TENTHS_PER_MINUTE
    return (
        DURATION_MIN_MINUTES <= minutes <= DURATION_MAX_MINUTES
        and abs(tenths - round(tenths)) < 1e-9
    )


def round_duration(minutes: float) -> float:
    return round(minutes * _TENTHS_PER_MINUTE) / _TENTHS_PER_MINUTE


def sum_durations(durations: Iterable[float]) -> float:
    return sum(round(minutes * _TENTHS_PER_MINUTE) for minutes in durations) / _TENTHS_PER_MINUTE


def total_duration(card: ProcessCardDetails) -> float:
    return sum_durations(operation.duration_minutes for operation in card.operations)


def operation_number(index: int) -> int:
    return (index + 1) * OPERATION_NUMBER_STEP


def referenced_operation_types(card: ProcessCardDetails) -> tuple[OperationTypeId, ...]:
    return tuple(dict.fromkeys(operation.operation_type_id for operation in card.operations))


def create_process_card_details(source: ProcessCardInput) -> ProcessCardDetails:
    if not OPERATIONS_COUNT.contains(len(source.operations)):
        raise DomainError(
            f'A process card must have {OPERATIONS_COUNT.min}-{OPERATIONS_COUNT.max} operations'
        )
    operations: list[Operation] = []
    for index, operation in enumerate(source.operations):
        number = operation_number(index)
        if not is_valid_duration(operation.duration_minutes):
            raise DomainError(f'Operation {number}: invalid duration {operation.duration_minutes}')
        equipment = optional_text(operation.equipment)
        if equipment is not None:
            assert_length(f'Operation {number} equipment', equipment, EQUIPMENT_LENGTH)
        operations.append(
            Operation(
                OperationTypeId(operation.operation_type_id),
                equipment,
                float(operation.duration_minutes),
            )
        )
    return ProcessCardDetails(PartId(source.part_id), tuple(operations))
```

## `api/src/api/domain/text.py`

```python
import re
from dataclasses import dataclass

from api.domain.errors import DomainError

_WHITESPACE = re.compile(r'\s+')


@dataclass(frozen=True, slots=True)
class Limits:
    min: int
    max: int

    def contains(self, length: int) -> bool:
        return self.min <= length <= self.max


def normalize_text(raw: str) -> str:
    return _WHITESPACE.sub(' ', raw.strip())


def optional_text(raw: str | None) -> str | None:
    return normalize_text(raw or '') or None


def assert_length(field: str, value: str, limits: Limits) -> None:
    if not limits.contains(len(value)):
        raise DomainError(f'{field} must be {limits.min}-{limits.max} characters long')
```

## `api/src/api/infrastructure/__init__.py`

```python

```

## `api/src/api/infrastructure/http/__init__.py`

```python

```

## `api/src/api/infrastructure/http/dependencies.py`

```python
from dataclasses import dataclass
from typing import Annotated, cast

from fastapi import Depends, Path, Request

from api.application.operation_types_service import OperationTypesService
from api.application.parts_service import PartsService
from api.application.ports import Storage
from api.application.process_cards_service import ProcessCardsService
from api.application.statistics_service import StatisticsService
from api.infrastructure.http.schemas import EXAMPLE_ID


@dataclass(frozen=True, slots=True)
class Services:
    storage: Storage
    parts: PartsService
    operation_types: OperationTypesService
    process_cards: ProcessCardsService
    statistics: StatisticsService

    @classmethod
    def build(cls, storage: Storage) -> 'Services':
        return cls(
            storage=storage,
            parts=PartsService(parts=storage.parts, process_cards=storage.process_cards),
            operation_types=OperationTypesService(
                operation_types=storage.operation_types, process_cards=storage.process_cards
            ),
            process_cards=ProcessCardsService(
                process_cards=storage.process_cards,
                parts=storage.parts,
                operation_types=storage.operation_types,
            ),
            statistics=StatisticsService(
                parts=storage.parts,
                operation_types=storage.operation_types,
                process_cards=storage.process_cards,
            ),
        )


def _services(request: Request) -> Services:
    return cast(Services, request.app.state.services)


def _storage(request: Request) -> Storage:
    return _services(request).storage


def _parts(request: Request) -> PartsService:
    return _services(request).parts


def _operation_types(request: Request) -> OperationTypesService:
    return _services(request).operation_types


def _process_cards(request: Request) -> ProcessCardsService:
    return _services(request).process_cards


def _statistics(request: Request) -> StatisticsService:
    return _services(request).statistics


StorageDep = Annotated[Storage, Depends(_storage)]
PartsDep = Annotated[PartsService, Depends(_parts)]
OperationTypesDep = Annotated[OperationTypesService, Depends(_operation_types)]
ProcessCardsDep = Annotated[ProcessCardsService, Depends(_process_cards)]
StatisticsDep = Annotated[StatisticsService, Depends(_statistics)]

ResourceId = Annotated[
    str,
    Path(
        min_length=1,
        max_length=64,
        description='Ідентифікатор запису (24 шістнадцяткові символи ObjectId)',
        examples=[EXAMPLE_ID],
    ),
]
```

## `api/src/api/infrastructure/http/errors.py`

```python
import logging
from collections.abc import Mapping, Sequence
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from api.application.errors import AppError, AppErrorCode, StorageUnavailableError
from api.domain.errors import DomainError
from api.infrastructure.http.schemas import (
    ErrorBody,
    ErrorCode,
    ErrorResponse,
    ValidationIssueDto,
)

logger = logging.getLogger('api.http')

STATUS_BY_APP_ERROR: Mapping[AppErrorCode, int] = {
    'NOT_FOUND': 404,
    'PART_DESIGNATION_TAKEN': 409,
    'OPERATION_TYPE_NAME_TAKEN': 409,
    'PART_ALREADY_HAS_CARD': 409,
    'PART_IN_USE': 409,
    'OPERATION_TYPE_IN_USE': 409,
    'UNKNOWN_PART': 422,
    'UNKNOWN_OPERATION_TYPE': 422,
}

ERROR_DESCRIPTIONS: Mapping[int, str] = {
    400: 'Некоректні дані запиту',
    404: 'Запис не знайдено',
    409: 'Конфлікт з наявними даними',
    422: 'Посилання на неіснуючу деталь чи вид обробки',
    503: 'База даних тимчасово недоступна',
}


def error_responses(*statuses: int) -> dict[int | str, dict[str, Any]]:
    return {
        status: {'model': ErrorResponse, 'description': ERROR_DESCRIPTIONS[status]}
        for status in (*statuses, 503)
    }


def error_response(
    status_code: int,
    code: ErrorCode,
    message: str,
    *,
    issues: Sequence[ValidationIssueDto] | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    body = ErrorResponse(error=ErrorBody(code=code, message=message, issues=issues))
    return JSONResponse(
        body.model_dump(mode='json', by_alias=True, exclude_none=True),
        status_code=status_code,
        headers=headers,
    )


def _issue_path(location: Sequence[int | str]) -> str:
    parts = [str(part) for part in location[1:]] if location[:1] in (('body',), ('path',)) else []
    return '.'.join(parts) or 'body'


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, error: AppError) -> JSONResponse:
        return error_response(STATUS_BY_APP_ERROR[error.code], error.code, error.message)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _request: Request, error: RequestValidationError
    ) -> JSONResponse:
        details = error.errors()
        if any(detail['type'] == 'json_invalid' for detail in details):
            return error_response(400, 'VALIDATION_ERROR', 'The request body is not valid JSON')
        issues = [
            ValidationIssueDto(path=_issue_path(detail['loc']), message=detail['msg'])
            for detail in details
        ]
        message = '; '.join(f'{issue.path}: {issue.message}' for issue in issues)
        return error_response(400, 'VALIDATION_ERROR', message, issues=issues)

    @app.exception_handler(DomainError)
    async def handle_domain_error(_request: Request, error: DomainError) -> JSONResponse:
        return error_response(400, 'VALIDATION_ERROR', str(error))

    @app.exception_handler(StorageUnavailableError)
    async def handle_storage_unavailable(
        request: Request, _error: StorageUnavailableError
    ) -> JSONResponse:
        logger.warning(
            'Database is unavailable', extra={'method': request.method, 'url': request.url.path}
        )
        return error_response(
            503,
            'DATABASE_UNAVAILABLE',
            'The database is temporarily unavailable',
            headers={'Retry-After': '5'},
        )

    @app.exception_handler(HTTPException)
    async def handle_http_error(request: Request, error: HTTPException) -> JSONResponse:
        route = f'{request.method} {request.url.path}'
        if error.status_code == 404:
            return error_response(404, 'NOT_FOUND', f'Route {route} not found')
        if error.status_code == 405:
            return error_response(
                405, 'METHOD_NOT_ALLOWED', f'Route {route} is not allowed', headers=error.headers
            )
        if error.status_code < 500:
            return error_response(error.status_code, 'VALIDATION_ERROR', str(error.detail))
        return error_response(error.status_code, 'INTERNAL_ERROR', 'Internal server error')
```

## `api/src/api/infrastructure/http/mappers.py`

```python
from api.application.process_cards_service import ProcessCardView
from api.application.statistics_service import Statistics
from api.domain.operation_type import OperationType
from api.domain.part import Part
from api.domain.process_card import operation_number, total_duration
from api.infrastructure.http.schemas import (
    OperationDto,
    OperationTypeDto,
    OperationTypeRefDto,
    PartDto,
    PartRefDto,
    ProcessCardDto,
    StatisticsResponse,
    WorkloadDto,
)


def to_part_dto(part: Part) -> PartDto:
    return PartDto(
        id=part.id,
        designation=part.designation,
        name=part.name,
        material=part.material,
        created_at=part.created_at,
        updated_at=part.updated_at,
    )


def to_operation_type_dto(operation_type: OperationType) -> OperationTypeDto:
    return OperationTypeDto(
        id=operation_type.id,
        name=operation_type.name,
        description=operation_type.description,
        created_at=operation_type.created_at,
        updated_at=operation_type.updated_at,
    )


def to_operation_type_ref(operation_type: OperationType) -> OperationTypeRefDto:
    return OperationTypeRefDto(id=operation_type.id, name=operation_type.name)


def to_process_card_dto(view: ProcessCardView) -> ProcessCardDto:
    card = view.card
    return ProcessCardDto(
        id=card.id,
        part=PartRefDto(
            id=view.part.id,
            designation=view.part.designation,
            name=view.part.name,
            material=view.part.material,
        ),
        operations=[
            OperationDto(
                number=operation_number(index),
                operation_type=to_operation_type_ref(
                    view.operation_types[operation.operation_type_id]
                ),
                equipment=operation.equipment,
                duration_minutes=operation.duration_minutes,
            )
            for index, operation in enumerate(card.operations)
        ],
        total_duration_minutes=total_duration(card),
        created_at=card.created_at,
        updated_at=card.updated_at,
    )


def to_statistics_response(statistics: Statistics) -> StatisticsResponse:
    return StatisticsResponse(
        parts=statistics.parts,
        operation_types=statistics.operation_types,
        process_cards=statistics.process_cards,
        operations=statistics.operations,
        total_duration_minutes=statistics.total_duration_minutes,
        workload=[
            WorkloadDto(
                operation_type=to_operation_type_ref(entry.operation_type),
                operations=entry.operations,
                total_duration_minutes=entry.total_duration_minutes,
            )
            for entry in statistics.workload
        ],
    )
```

## `api/src/api/infrastructure/http/middleware.py`

```python
import logging
import time
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response

from api.infrastructure.http.errors import error_response

API_PREFIX = '/api'

logger = logging.getLogger('api.http')


def _too_large(request: Request, limit: int) -> bool:
    length = request.headers.get('content-length', '')
    return length.isdigit() and int(length) > limit


def install_middleware(app: FastAPI, *, body_limit_bytes: int) -> None:
    @app.middleware('http')
    async def handle_request(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        started = time.perf_counter()
        path = request.url.path
        try:
            if _too_large(request, body_limit_bytes):
                response: Response = error_response(
                    413, 'VALIDATION_ERROR', 'The request body is too large'
                )
            else:
                response = await call_next(request)
        except Exception:
            logger.exception('Request failed', extra={'method': request.method, 'url': path})
            response = error_response(500, 'INTERNAL_ERROR', 'Internal server error')

        response.headers['X-Content-Type-Options'] = 'nosniff'
        is_api = path == API_PREFIX or path.startswith(f'{API_PREFIX}/')
        if is_api:
            response.headers['Cache-Control'] = 'no-store'
        logger.log(
            logging.INFO if is_api else logging.DEBUG,
            'Request completed',
            extra={
                'method': request.method,
                'url': path,
                'statusCode': response.status_code,
                'durationMs': round((time.perf_counter() - started) * 1000),
            },
        )
        return response
```

## `api/src/api/infrastructure/http/openapi.py`

```python
from typing import Any

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi
from fastapi.routing import APIRoute

OPENAPI_URL = '/api/openapi.json'

TITLE = 'Технологічні карти'
VERSION = '1.0.0'
DESCRIPTION = """
REST API лабораторної роботи №5 (варіант 11): база даних технологічних карт деталей
з видом обробки й тривалістю кожної операції.

* **Деталі** — позначення, найменування й матеріал.
* **Види обробки** — довідник операцій: токарна, фрезерна, шліфувальна тощо.
* **Технологічні карти** — маршрут обробки деталі: операції з видом обробки, обладнанням
  і тривалістю у хвилинах.

Усі помилки мають єдиний формат `{"error": {"code", "message", "issues"}}`. Поле `issues`
є лише в помилках валідації (код 400) і вказує конкретні поля.
"""

TAGS = [
    {'name': 'Деталі', 'description': 'CRUD деталей, для яких складаються технологічні карти'},
    {'name': 'Види обробки', 'description': 'CRUD довідника видів обробки'},
    {
        'name': 'Технологічні карти',
        'description': 'CRUD технологічних карт: одна карта на деталь, від 1 до 30 операцій',
    },
    {'name': 'Статистика', 'description': 'Зведені показники та трудомісткість'},
    {'name': 'Стан', 'description': 'Перевірка роботи сервера й підключення до MongoDB'},
]

_DEFAULT_VALIDATION_SCHEMAS = ('HTTPValidationError', 'ValidationError')


def operation_id(route: APIRoute) -> str:
    head, *rest = route.name.split('_')
    return head + ''.join(word.capitalize() for word in rest)


class DocumentedApi(FastAPI):
    def openapi(self) -> dict[str, Any]:
        if self.openapi_schema:
            return self.openapi_schema
        schema = get_openapi(
            title=self.title,
            version=self.version,
            description=self.description,
            routes=self.routes,
            tags=self.openapi_tags,
        )
        for path_item in schema.get('paths', {}).values():
            for operation in path_item.values():
                responses = operation.get('responses', {})
                if responses.get('422', {}).get('description') == 'Validation Error':
                    del responses['422']
        components = schema.get('components', {}).get('schemas', {})
        for name in _DEFAULT_VALIDATION_SCHEMAS:
            components.pop(name, None)
        self.openapi_schema = schema
        return schema
```

## `api/src/api/infrastructure/http/router.py`

```python
from fastapi import APIRouter

from api.infrastructure.http.routes import operation_types, parts, process_cards, system


def api_router() -> APIRouter:
    router = APIRouter(prefix='/api')
    for child in (parts.router, operation_types.router, process_cards.router, system.router):
        router.include_router(child)
    return router
```

## `api/src/api/infrastructure/http/routes/__init__.py`

```python

```

## `api/src/api/infrastructure/http/routes/operation_types.py`

```python
from fastapi import APIRouter, Request, Response

from api.domain.operation_type import OperationTypeId
from api.infrastructure.http.dependencies import OperationTypesDep, ResourceId
from api.infrastructure.http.errors import error_responses
from api.infrastructure.http.mappers import to_operation_type_dto
from api.infrastructure.http.schemas import (
    OperationTypeRequest,
    OperationTypeResponse,
    OperationTypesResponse,
)

router = APIRouter(prefix='/operation-types', tags=['Види обробки'])


@router.get('', summary='Усі види обробки', responses=error_responses())
async def list_operation_types(service: OperationTypesDep) -> OperationTypesResponse:
    return OperationTypesResponse(
        operation_types=[to_operation_type_dto(item) for item in await service.list_all()]
    )


@router.get('/{operation_type_id}', summary='Один вид обробки', responses=error_responses(400, 404))
async def get_operation_type(
    operation_type_id: ResourceId, service: OperationTypesDep
) -> OperationTypeResponse:
    operation_type = await service.get(OperationTypeId(operation_type_id))
    return OperationTypeResponse(operation_type=to_operation_type_dto(operation_type))


@router.post(
    '',
    status_code=201,
    summary='Додати вид обробки',
    description='Перша літера назви стає великою, назва унікальна без урахування регістру.',
    responses=error_responses(400, 409),
)
async def create_operation_type(
    body: OperationTypeRequest, service: OperationTypesDep, request: Request, response: Response
) -> OperationTypeResponse:
    operation_type = await service.create(body.to_input())
    response.headers['Location'] = request.app.url_path_for(
        'get_operation_type', operation_type_id=operation_type.id
    )
    return OperationTypeResponse(operation_type=to_operation_type_dto(operation_type))


@router.put(
    '/{operation_type_id}',
    summary='Редагувати вид обробки',
    responses=error_responses(400, 404, 409),
)
async def update_operation_type(
    operation_type_id: ResourceId, body: OperationTypeRequest, service: OperationTypesDep
) -> OperationTypeResponse:
    operation_type = await service.update(OperationTypeId(operation_type_id), body.to_input())
    return OperationTypeResponse(operation_type=to_operation_type_dto(operation_type))


@router.delete(
    '/{operation_type_id}',
    status_code=204,
    summary='Видалити вид обробки',
    description='Вид обробки, що використовується в операціях карт, видалити не можна (код 409).',
    responses=error_responses(400, 404, 409),
)
async def delete_operation_type(operation_type_id: ResourceId, service: OperationTypesDep) -> None:
    await service.delete(OperationTypeId(operation_type_id))
```

## `api/src/api/infrastructure/http/routes/parts.py`

```python
from fastapi import APIRouter, Request, Response

from api.domain.part import PartId
from api.infrastructure.http.dependencies import PartsDep, ResourceId
from api.infrastructure.http.errors import error_responses
from api.infrastructure.http.mappers import to_part_dto
from api.infrastructure.http.schemas import PartRequest, PartResponse, PartsResponse

router = APIRouter(prefix='/parts', tags=['Деталі'])


@router.get('', summary='Усі деталі', responses=error_responses())
async def list_parts(service: PartsDep) -> PartsResponse:
    return PartsResponse(parts=[to_part_dto(part) for part in await service.list_all()])


@router.get('/{part_id}', summary='Одна деталь', responses=error_responses(400, 404))
async def get_part(part_id: ResourceId, service: PartsDep) -> PartResponse:
    return PartResponse(part=to_part_dto(await service.get(PartId(part_id))))


@router.post(
    '',
    status_code=201,
    summary='Додати деталь',
    description='Позначення переводиться у верхній регістр і має бути унікальним. '
    'У заголовку Location повертається адреса створеного запису.',
    responses=error_responses(400, 409),
)
async def create_part(
    body: PartRequest, service: PartsDep, request: Request, response: Response
) -> PartResponse:
    part = await service.create(body.to_input())
    response.headers['Location'] = request.app.url_path_for('get_part', part_id=part.id)
    return PartResponse(part=to_part_dto(part))


@router.put(
    '/{part_id}',
    summary='Редагувати деталь',
    description='Повністю замінює дані деталі.',
    responses=error_responses(400, 404, 409),
)
async def update_part(part_id: ResourceId, body: PartRequest, service: PartsDep) -> PartResponse:
    return PartResponse(part=to_part_dto(await service.update(PartId(part_id), body.to_input())))


@router.delete(
    '/{part_id}',
    status_code=204,
    summary='Видалити деталь',
    description='Деталь, для якої існує технологічна карта, видалити не можна (код 409).',
    responses=error_responses(400, 404, 409),
)
async def delete_part(part_id: ResourceId, service: PartsDep) -> None:
    await service.delete(PartId(part_id))
```

## `api/src/api/infrastructure/http/routes/process_cards.py`

```python
from fastapi import APIRouter, Request, Response

from api.domain.process_card import ProcessCardId
from api.infrastructure.http.dependencies import ProcessCardsDep, ResourceId
from api.infrastructure.http.errors import error_responses
from api.infrastructure.http.mappers import to_process_card_dto
from api.infrastructure.http.schemas import (
    ProcessCardRequest,
    ProcessCardResponse,
    ProcessCardsResponse,
)

router = APIRouter(prefix='/process-cards', tags=['Технологічні карти'])


@router.get(
    '',
    summary='Усі технологічні карти',
    description='Карти з деталлю, операціями й сумарною тривалістю, відсортовані за позначенням.',
    responses=error_responses(),
)
async def list_process_cards(service: ProcessCardsDep) -> ProcessCardsResponse:
    return ProcessCardsResponse(
        process_cards=[to_process_card_dto(view) for view in await service.list_all()]
    )


@router.get(
    '/{process_card_id}', summary='Одна технологічна карта', responses=error_responses(400, 404)
)
async def get_process_card(
    process_card_id: ResourceId, service: ProcessCardsDep
) -> ProcessCardResponse:
    view = await service.get(ProcessCardId(process_card_id))
    return ProcessCardResponse(process_card=to_process_card_dto(view))


@router.post(
    '',
    status_code=201,
    summary='Додати технологічну карту',
    description='Для кожної деталі може існувати лише одна карта. Деталь і види обробки '
    'мають існувати, інакше повертається код 422.',
    responses=error_responses(400, 409, 422),
)
async def create_process_card(
    body: ProcessCardRequest, service: ProcessCardsDep, request: Request, response: Response
) -> ProcessCardResponse:
    view = await service.create(body.to_input())
    response.headers['Location'] = request.app.url_path_for(
        'get_process_card', process_card_id=view.card.id
    )
    return ProcessCardResponse(process_card=to_process_card_dto(view))


@router.put(
    '/{process_card_id}',
    summary='Редагувати технологічну карту',
    description='Повністю замінює деталь і список операцій карти.',
    responses=error_responses(400, 404, 409, 422),
)
async def update_process_card(
    process_card_id: ResourceId, body: ProcessCardRequest, service: ProcessCardsDep
) -> ProcessCardResponse:
    view = await service.update(ProcessCardId(process_card_id), body.to_input())
    return ProcessCardResponse(process_card=to_process_card_dto(view))


@router.delete(
    '/{process_card_id}',
    status_code=204,
    summary='Видалити технологічну карту',
    responses=error_responses(400, 404),
)
async def delete_process_card(process_card_id: ResourceId, service: ProcessCardsDep) -> None:
    await service.delete(ProcessCardId(process_card_id))
```

## `api/src/api/infrastructure/http/routes/system.py`

```python
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from api.infrastructure.http.dependencies import StatisticsDep, StorageDep
from api.infrastructure.http.errors import error_responses
from api.infrastructure.http.mappers import to_statistics_response
from api.infrastructure.http.schemas import HealthResponse, StatisticsResponse

router = APIRouter()


@router.get(
    '/statistics',
    tags=['Статистика'],
    summary='Статистика й трудомісткість',
    description='Кількість записів і сумарна тривалість операцій за кожним видом обробки, '
    'яку рахує конвеєр агрегації MongoDB.',
    responses=error_responses(),
)
async def get_statistics(service: StatisticsDep) -> StatisticsResponse:
    return to_statistics_response(await service.collect())


@router.get(
    '/health',
    tags=['Стан'],
    summary='Стан сервера й бази даних',
    response_model=HealthResponse,
    responses={503: {'model': HealthResponse, 'description': 'База даних недоступна'}},
)
async def get_health(storage: StorageDep) -> HealthResponse | JSONResponse:
    if await storage.is_available():
        return HealthResponse(status='ok', database='up')
    body = HealthResponse(status='degraded', database='down')
    return JSONResponse(body.model_dump(mode='json'), status_code=503)
```

## `api/src/api/infrastructure/http/schemas.py`

```python
from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PlainSerializer,
    WithJsonSchema,
    field_validator,
)
from pydantic.alias_generators import to_camel
from pydantic_core import PydanticCustomError

from api.domain.operation_type import (
    OPERATION_TYPE_DESCRIPTION_LENGTH,
    OPERATION_TYPE_NAME_LENGTH,
    OperationTypeInput,
)
from api.domain.part import (
    PART_MATERIAL_LENGTH,
    PART_NAME_LENGTH,
    PartInput,
    is_valid_designation,
)
from api.domain.process_card import (
    DURATION_MAX_MINUTES,
    DURATION_MIN_MINUTES,
    EQUIPMENT_LENGTH,
    OPERATIONS_COUNT,
    OperationInput,
    ProcessCardInput,
    is_valid_duration,
)
from api.domain.text import Limits, normalize_text

EXAMPLE_ID = '6acbf38bddbf20c6012ff1f0'
EXAMPLE_TIMESTAMP = '2026-11-02T10:00:00.000Z'


def iso_timestamp(value: datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


Timestamp = Annotated[
    datetime,
    PlainSerializer(iso_timestamp, return_type=str),
    WithJsonSchema({'type': 'string', 'format': 'date-time', 'examples': [EXAMPLE_TIMESTAMP]}),
]


def _check_length(value: str, limits: Limits) -> str:
    if not limits.contains(len(normalize_text(value))):
        raise PydanticCustomError('length', f'Must be {limits.min}-{limits.max} characters long')
    return value


def _check_max_length(value: str | None, limits: Limits) -> str | None:
    if value is not None and len(normalize_text(value)) > limits.max:
        raise PydanticCustomError('length', f'Must be at most {limits.max} characters long')
    return value


class Schema(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, frozen=True)


class RequestSchema(Schema):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, frozen=True, extra='forbid'
    )


class PartRequest(RequestSchema):
    model_config = ConfigDict(
        json_schema_extra={
            'examples': [{'designation': 'КПІ.320.008', 'name': 'Фланець', 'material': 'Сталь 20'}]
        }
    )

    designation: Annotated[
        str,
        Field(
            max_length=64,
            description='Позначення (креслярський номер): 3–40 літер, цифр, крапок, дефісів або '
            'скісних рисок; починається й закінчується літерою чи цифрою. '
            'Зберігається у верхньому регістрі й унікальне.',
        ),
    ]
    name: Annotated[
        str,
        Field(description=f'Найменування, {PART_NAME_LENGTH.min}–{PART_NAME_LENGTH.max} символів'),
    ]
    material: Annotated[
        str | None,
        Field(description=f'Матеріал, до {PART_MATERIAL_LENGTH.max} символів'),
    ] = None

    @field_validator('designation')
    @classmethod
    def _check_designation(cls, value: str) -> str:
        if not is_valid_designation(value):
            raise PydanticCustomError(
                'designation',
                'Must be 3-40 letters, digits, dots, dashes or slashes, '
                'starting and ending with a letter or digit',
            )
        return value

    @field_validator('name')
    @classmethod
    def _check_name(cls, value: str) -> str:
        return _check_length(value, PART_NAME_LENGTH)

    @field_validator('material')
    @classmethod
    def _check_material(cls, value: str | None) -> str | None:
        return _check_max_length(value, PART_MATERIAL_LENGTH)

    def to_input(self) -> PartInput:
        return PartInput(designation=self.designation, name=self.name, material=self.material)


class OperationTypeRequest(RequestSchema):
    model_config = ConfigDict(
        json_schema_extra={
            'examples': [
                {
                    'name': 'Зубофрезерна',
                    'description': 'Нарізання зубів коліс черв’ячною фрезою',
                }
            ]
        }
    )

    name: Annotated[
        str,
        Field(
            description=f'Назва, {OPERATION_TYPE_NAME_LENGTH.min}–{OPERATION_TYPE_NAME_LENGTH.max} '
            'символів, унікальна без урахування регістру',
        ),
    ]
    description: Annotated[
        str | None,
        Field(description=f'Опис, до {OPERATION_TYPE_DESCRIPTION_LENGTH.max} символів'),
    ] = None

    @field_validator('name')
    @classmethod
    def _check_name(cls, value: str) -> str:
        return _check_length(value, OPERATION_TYPE_NAME_LENGTH)

    @field_validator('description')
    @classmethod
    def _check_description(cls, value: str | None) -> str | None:
        return _check_max_length(value, OPERATION_TYPE_DESCRIPTION_LENGTH)

    def to_input(self) -> OperationTypeInput:
        return OperationTypeInput(name=self.name, description=self.description)


class OperationRequest(RequestSchema):
    operation_type_id: Annotated[
        str, Field(min_length=1, max_length=64, description='Ідентифікатор виду обробки')
    ]
    equipment: Annotated[
        str | None,
        Field(description=f'Обладнання, до {EQUIPMENT_LENGTH.max} символів'),
    ] = None
    duration_minutes: Annotated[
        float,
        Field(
            strict=True,
            description=f'Тривалість у хвилинах: від {DURATION_MIN_MINUTES} до '
            f'{DURATION_MAX_MINUTES:g} з точністю до 0,1',
        ),
    ]

    @field_validator('equipment')
    @classmethod
    def _check_equipment(cls, value: str | None) -> str | None:
        return _check_max_length(value, EQUIPMENT_LENGTH)

    @field_validator('duration_minutes')
    @classmethod
    def _check_duration(cls, value: float) -> float:
        if not is_valid_duration(value):
            raise PydanticCustomError(
                'duration',
                f'Must be {DURATION_MIN_MINUTES}-{DURATION_MAX_MINUTES:g} minutes '
                'with at most one decimal place',
            )
        return value

    def to_input(self) -> OperationInput:
        return OperationInput(
            operation_type_id=self.operation_type_id,
            equipment=self.equipment,
            duration_minutes=self.duration_minutes,
        )


class ProcessCardRequest(RequestSchema):
    model_config = ConfigDict(
        json_schema_extra={
            'examples': [
                {
                    'partId': EXAMPLE_ID,
                    'operations': [
                        {
                            'operationTypeId': '6acbf38bddbf20c6012ff1e9',
                            'equipment': 'Токарно-гвинторізний верстат 16К20',
                            'durationMinutes': 18.5,
                        },
                        {'operationTypeId': '6acbf38bddbf20c6012ff1ef', 'durationMinutes': 4},
                    ],
                }
            ]
        }
    )

    part_id: Annotated[str, Field(min_length=1, max_length=64, description='Ідентифікатор деталі')]
    operations: Annotated[
        list[OperationRequest],
        Field(
            min_length=OPERATIONS_COUNT.min,
            max_length=OPERATIONS_COUNT.max,
            description='Операції в порядку виконання; номери 005, 010… призначаються за порядком',
        ),
    ]

    def to_input(self) -> ProcessCardInput:
        return ProcessCardInput(
            part_id=self.part_id,
            operations=[operation.to_input() for operation in self.operations],
        )


class PartDto(Schema):
    id: str = Field(examples=[EXAMPLE_ID])
    designation: str = Field(examples=['КПІ.301.011'])
    name: str = Field(examples=['Вал ведучий'])
    material: str | None = Field(examples=['Сталь 45'])
    created_at: Timestamp
    updated_at: Timestamp


class PartResponse(Schema):
    part: PartDto


class PartsResponse(Schema):
    parts: list[PartDto]


class OperationTypeDto(Schema):
    id: str = Field(examples=['6acbf38bddbf20c6012ff1e9'])
    name: str = Field(examples=['Токарна'])
    description: str | None = Field(
        examples=['Обробка поверхонь обертання різцями на токарному верстаті']
    )
    created_at: Timestamp
    updated_at: Timestamp


class OperationTypeResponse(Schema):
    operation_type: OperationTypeDto


class OperationTypesResponse(Schema):
    operation_types: list[OperationTypeDto]


class PartRefDto(Schema):
    id: str
    designation: str
    name: str
    material: str | None


class OperationTypeRefDto(Schema):
    id: str
    name: str


class OperationDto(Schema):
    number: int = Field(description='Номер операції з кроком 5', examples=[5])
    operation_type: OperationTypeRefDto
    equipment: str | None
    duration_minutes: float = Field(examples=[18.5])


class ProcessCardDto(Schema):
    id: str
    part: PartRefDto
    operations: list[OperationDto]
    total_duration_minutes: float = Field(description='Сумарна тривалість операцій, хв')
    created_at: Timestamp
    updated_at: Timestamp


class ProcessCardResponse(Schema):
    process_card: ProcessCardDto


class ProcessCardsResponse(Schema):
    process_cards: list[ProcessCardDto]


class WorkloadDto(Schema):
    operation_type: OperationTypeRefDto
    operations: int
    total_duration_minutes: float


class StatisticsResponse(Schema):
    parts: int
    operation_types: int
    process_cards: int
    operations: int
    total_duration_minutes: float
    workload: list[WorkloadDto] = Field(description='Трудомісткість кожного виду обробки')


class HealthResponse(Schema):
    status: Literal['ok', 'degraded']
    database: Literal['up', 'down']


ErrorCode = Literal[
    'VALIDATION_ERROR',
    'NOT_FOUND',
    'METHOD_NOT_ALLOWED',
    'PART_DESIGNATION_TAKEN',
    'OPERATION_TYPE_NAME_TAKEN',
    'PART_ALREADY_HAS_CARD',
    'PART_IN_USE',
    'OPERATION_TYPE_IN_USE',
    'UNKNOWN_PART',
    'UNKNOWN_OPERATION_TYPE',
    'DATABASE_UNAVAILABLE',
    'INTERNAL_ERROR',
]


class ValidationIssueDto(Schema):
    path: str = Field(examples=['operations.0.durationMinutes'])
    message: str


class ErrorBody(Schema):
    code: ErrorCode
    message: str
    issues: list[ValidationIssueDto] | None = None


class ErrorResponse(Schema):
    error: ErrorBody
```

## `api/src/api/infrastructure/http/static.py`

```python
import re
from pathlib import Path, PurePosixPath

from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

HASHED_ASSET = re.compile(r'-[A-Z0-9]{8,}\.[a-z0-9]+$')
IMMUTABLE = 'public, max-age=31536000, immutable'


class ClientFiles(StaticFiles):
    def __init__(self, directory: Path) -> None:
        if not (directory / 'index.html').is_file():
            raise RuntimeError(f'STATIC_DIR does not contain index.html: {directory}')
        super().__init__(directory=directory, html=True)

    async def get_response(self, path: str, scope: Scope) -> Response:
        if path == 'api' or path.startswith('api/'):
            raise HTTPException(status_code=404)
        try:
            response = await super().get_response(path, scope)
        except HTTPException as error:
            is_page = scope['method'] in {'GET', 'HEAD'} and not PurePosixPath(path).suffix
            if error.status_code != 404 or not is_page:
                raise
            response = await super().get_response('index.html', scope)
            response.headers['Cache-Control'] = 'no-cache'
            return response
        response.headers['Cache-Control'] = IMMUTABLE if HASHED_ASSET.search(path) else 'no-cache'
        return response
```

## `api/src/api/infrastructure/logging_setup.py`

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
QUIET_LOGGERS = ('pymongo', 'watchfiles', 'uvicorn.access')


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

## `api/src/api/infrastructure/mongo/__init__.py`

```python

```

## `api/src/api/infrastructure/mongo/errors.py`

```python
from collections.abc import Iterator
from contextlib import contextmanager

from pymongo.errors import ConnectionFailure

from api.application.errors import StorageUnavailableError


@contextmanager
def storage_errors() -> Iterator[None]:
    try:
        yield
    except ConnectionFailure as error:
        raise StorageUnavailableError('MongoDB is unavailable') from error
```

## `api/src/api/infrastructure/mongo/records.py`

```python
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

from bson import ObjectId

from api.domain.operation_type import OperationType, OperationTypeDetails, OperationTypeId
from api.domain.part import Part, PartDetails, PartId
from api.domain.process_card import Operation, ProcessCard, ProcessCardDetails, ProcessCardId

type Document = dict[str, Any]


def object_id(value: str) -> ObjectId | None:
    return ObjectId(value) if ObjectId.is_valid(value) else None


def utc_now() -> datetime:
    now = datetime.now(UTC)
    return now.replace(microsecond=now.microsecond // 1000 * 1000)


def to_part(document: Mapping[str, Any]) -> Part:
    return Part(
        id=PartId(str(document['_id'])),
        designation=document['designation'],
        name=document['name'],
        material=document.get('material'),
        created_at=document['createdAt'],
        updated_at=document['updatedAt'],
    )


def part_document(details: PartDetails) -> Document:
    return {
        'designation': details.designation,
        'name': details.name,
        'material': details.material,
    }


def to_operation_type(document: Mapping[str, Any]) -> OperationType:
    return OperationType(
        id=OperationTypeId(str(document['_id'])),
        name=document['name'],
        description=document.get('description'),
        created_at=document['createdAt'],
        updated_at=document['updatedAt'],
    )


def operation_type_document(details: OperationTypeDetails) -> Document:
    return {'name': details.name, 'description': details.description}


def to_process_card(document: Mapping[str, Any]) -> ProcessCard:
    return ProcessCard(
        id=ProcessCardId(str(document['_id'])),
        part_id=PartId(str(document['part'])),
        operations=tuple(
            Operation(
                operation_type_id=OperationTypeId(str(operation['operationType'])),
                equipment=operation.get('equipment'),
                duration_minutes=float(operation['durationMinutes']),
            )
            for operation in document['operations']
        ),
        created_at=document['createdAt'],
        updated_at=document['updatedAt'],
    )


def process_card_document(details: ProcessCardDetails) -> Document:
    return {
        'part': ObjectId(details.part_id),
        'operations': [
            {
                'operationType': ObjectId(operation.operation_type_id),
                'equipment': operation.equipment,
                'durationMinutes': operation.duration_minutes,
            }
            for operation in details.operations
        ],
    }
```

## `api/src/api/infrastructure/mongo/repositories.py`

```python
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from pymongo import ASCENDING, ReturnDocument
from pymongo.asynchronous.collection import AsyncCollection
from pymongo.collation import Collation
from pymongo.errors import DuplicateKeyError

from api.application.ports import OperationTypeWorkload, Rejected, Saved, WriteResult
from api.domain.operation_type import OperationType, OperationTypeDetails, OperationTypeId
from api.domain.part import Part, PartDetails, PartId
from api.domain.process_card import (
    ProcessCard,
    ProcessCardDetails,
    ProcessCardId,
    round_duration,
)
from api.infrastructure.mongo.errors import storage_errors
from api.infrastructure.mongo.records import (
    Document,
    object_id,
    operation_type_document,
    part_document,
    process_card_document,
    to_operation_type,
    to_part,
    to_process_card,
    utc_now,
)
from api.infrastructure.mongo.schema import UKRAINIAN_CASE_INSENSITIVE

type Collection = AsyncCollection[Document]


class MongoRepository[TEntity, TDetails, TId: str]:
    def __init__(
        self,
        collection: Collection,
        *,
        to_entity: Callable[[Mapping[str, Any]], TEntity],
        to_document: Callable[[TDetails], Document],
        sort: Sequence[tuple[str, int]],
        collation: Collation | None = None,
    ) -> None:
        self._collection = collection
        self._to_entity = to_entity
        self._to_document = to_document
        self._sort = list(sort)
        self._collation = collation

    async def list_all(self) -> Sequence[TEntity]:
        with storage_errors():
            cursor = self._collection.find({}, sort=self._sort, collation=self._collation)
            return [self._to_entity(document) async for document in cursor]

    async def count(self) -> int:
        with storage_errors():
            return await self._collection.count_documents({})

    async def find(self, entity_id: TId) -> TEntity | None:
        key = object_id(entity_id)
        if key is None:
            return None
        with storage_errors():
            document = await self._collection.find_one({'_id': key})
        return None if document is None else self._to_entity(document)

    async def find_many(self, entity_ids: Sequence[TId]) -> Sequence[TEntity]:
        keys = [key for key in map(object_id, entity_ids) if key is not None]
        if not keys:
            return []
        with storage_errors():
            cursor = self._collection.find({'_id': {'$in': keys}})
            return [self._to_entity(document) async for document in cursor]

    async def create(self, details: TDetails) -> WriteResult[TEntity]:
        now = utc_now()
        document = {**self._to_document(details), 'createdAt': now, 'updatedAt': now}
        with storage_errors():
            try:
                result = await self._collection.insert_one(document)
            except DuplicateKeyError:
                return Rejected('duplicate')
        return Saved(self._to_entity({**document, '_id': result.inserted_id}))

    async def update(self, entity_id: TId, details: TDetails) -> WriteResult[TEntity]:
        key = object_id(entity_id)
        if key is None:
            return Rejected('not-found')
        changes = {**self._to_document(details), 'updatedAt': utc_now()}
        with storage_errors():
            try:
                document = await self._collection.find_one_and_update(
                    {'_id': key}, {'$set': changes}, return_document=ReturnDocument.AFTER
                )
            except DuplicateKeyError:
                return Rejected('duplicate')
        return Rejected('not-found') if document is None else Saved(self._to_entity(document))

    async def delete(self, entity_id: TId) -> bool:
        key = object_id(entity_id)
        if key is None:
            return False
        with storage_errors():
            result = await self._collection.delete_one({'_id': key})
        return result.deleted_count == 1


class MongoPartRepository(MongoRepository[Part, PartDetails, PartId]):
    def __init__(self, collection: Collection) -> None:
        super().__init__(
            collection,
            to_entity=to_part,
            to_document=part_document,
            sort=[('designation', ASCENDING)],
            collation=Collation(locale='uk', numericOrdering=True),
        )


class MongoOperationTypeRepository(
    MongoRepository[OperationType, OperationTypeDetails, OperationTypeId]
):
    def __init__(self, collection: Collection) -> None:
        super().__init__(
            collection,
            to_entity=to_operation_type,
            to_document=operation_type_document,
            sort=[('name', ASCENDING)],
            collation=UKRAINIAN_CASE_INSENSITIVE,
        )


class MongoProcessCardRepository(MongoRepository[ProcessCard, ProcessCardDetails, ProcessCardId]):
    def __init__(self, collection: Collection) -> None:
        super().__init__(
            collection,
            to_entity=to_process_card,
            to_document=process_card_document,
            sort=[('createdAt', ASCENDING)],
        )

    async def is_part_used(self, part_id: PartId) -> bool:
        return await self._exists('part', part_id)

    async def is_operation_type_used(self, operation_type_id: OperationTypeId) -> bool:
        return await self._exists('operations.operationType', operation_type_id)

    async def workload(self) -> Sequence[OperationTypeWorkload]:
        pipeline: list[Document] = [
            {'$unwind': '$operations'},
            {
                '$group': {
                    '_id': '$operations.operationType',
                    'operations': {'$sum': 1},
                    'totalDurationMinutes': {'$sum': '$operations.durationMinutes'},
                }
            },
        ]
        with storage_errors():
            cursor = await self._collection.aggregate(pipeline)
            return [
                OperationTypeWorkload(
                    operation_type_id=OperationTypeId(str(row['_id'])),
                    operations=row['operations'],
                    total_duration_minutes=round_duration(row['totalDurationMinutes']),
                )
                async for row in cursor
            ]

    async def _exists(self, field: str, value: str) -> bool:
        key = object_id(value)
        if key is None:
            return False
        with storage_errors():
            return await self._collection.find_one({field: key}, projection={'_id': 1}) is not None
```

## `api/src/api/infrastructure/mongo/schema.py`

```python
from typing import Any

from pymongo import ASCENDING, IndexModel
from pymongo.collation import Collation

from api.domain.operation_type import OPERATION_TYPE_DESCRIPTION_LENGTH, OPERATION_TYPE_NAME_LENGTH
from api.domain.part import PART_DESIGNATION_LENGTH, PART_MATERIAL_LENGTH, PART_NAME_LENGTH
from api.domain.process_card import (
    DURATION_MAX_MINUTES,
    DURATION_MIN_MINUTES,
    EQUIPMENT_LENGTH,
    OPERATIONS_COUNT,
)
from api.domain.text import Limits

PARTS = 'parts'
OPERATION_TYPES = 'operation_types'
PROCESS_CARDS = 'process_cards'

UKRAINIAN_CASE_INSENSITIVE = Collation(locale='uk', strength=2)


def _text(limits: Limits) -> dict[str, Any]:
    return {'bsonType': 'string', 'minLength': limits.min, 'maxLength': limits.max}


def _optional_text(limits: Limits) -> dict[str, Any]:
    return {'bsonType': ['string', 'null'], 'maxLength': limits.max}


_TIMESTAMP = {'bsonType': 'date'}


def _record(properties: dict[str, Any]) -> dict[str, Any]:
    return {
        '$jsonSchema': {
            'bsonType': 'object',
            'required': [*properties, 'createdAt', 'updatedAt'],
            'additionalProperties': False,
            'properties': {
                '_id': {'bsonType': 'objectId'},
                **properties,
                'createdAt': _TIMESTAMP,
                'updatedAt': _TIMESTAMP,
            },
        }
    }


VALIDATORS: dict[str, dict[str, Any]] = {
    PARTS: _record(
        {
            'designation': _text(PART_DESIGNATION_LENGTH),
            'name': _text(PART_NAME_LENGTH),
            'material': _optional_text(PART_MATERIAL_LENGTH),
        }
    ),
    OPERATION_TYPES: _record(
        {
            'name': _text(OPERATION_TYPE_NAME_LENGTH),
            'description': _optional_text(OPERATION_TYPE_DESCRIPTION_LENGTH),
        }
    ),
    PROCESS_CARDS: _record(
        {
            'part': {'bsonType': 'objectId'},
            'operations': {
                'bsonType': 'array',
                'minItems': OPERATIONS_COUNT.min,
                'maxItems': OPERATIONS_COUNT.max,
                'items': {
                    'bsonType': 'object',
                    'required': ['operationType', 'equipment', 'durationMinutes'],
                    'additionalProperties': False,
                    'properties': {
                        'operationType': {'bsonType': 'objectId'},
                        'equipment': _optional_text(EQUIPMENT_LENGTH),
                        'durationMinutes': {
                            'bsonType': ['double', 'int'],
                            'minimum': DURATION_MIN_MINUTES,
                            'maximum': DURATION_MAX_MINUTES,
                        },
                    },
                },
            },
        }
    ),
}

INDEXES: dict[str, list[IndexModel]] = {
    PARTS: [IndexModel([('designation', ASCENDING)], name='designation_1', unique=True)],
    OPERATION_TYPES: [
        IndexModel(
            [('name', ASCENDING)],
            name='name_1',
            unique=True,
            collation=UKRAINIAN_CASE_INSENSITIVE,
        )
    ],
    PROCESS_CARDS: [
        IndexModel([('part', ASCENDING)], name='part_1', unique=True),
        IndexModel([('operations.operationType', ASCENDING)], name='operations.operationType_1'),
    ],
}
```

## `api/src/api/infrastructure/mongo/storage.py`

```python
import logging

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import ConnectionFailure, PyMongoError

from api.application.errors import StorageUnavailableError
from api.infrastructure.mongo.records import Document
from api.infrastructure.mongo.repositories import (
    MongoOperationTypeRepository,
    MongoPartRepository,
    MongoProcessCardRepository,
)
from api.infrastructure.mongo.schema import (
    INDEXES,
    OPERATION_TYPES,
    PARTS,
    PROCESS_CARDS,
    VALIDATORS,
)

DEFAULT_DATABASE = 'lab05'

logger = logging.getLogger('api.mongodb')


class MongoStorage:
    def __init__(
        self, client: AsyncMongoClient[Document], database: AsyncDatabase[Document]
    ) -> None:
        self._client = client
        self.parts = MongoPartRepository(database[PARTS])
        self.operation_types = MongoOperationTypeRepository(database[OPERATION_TYPES])
        self.process_cards = MongoProcessCardRepository(database[PROCESS_CARDS])

    @classmethod
    async def connect(cls, *, uri: str, timeout_ms: int) -> 'MongoStorage':
        client: AsyncMongoClient[Document] = AsyncMongoClient(
            uri, serverSelectionTimeoutMS=timeout_ms, tz_aware=True, appname='lab-05-fastapi'
        )
        try:
            await client.admin.command('ping')
        except ConnectionFailure as error:
            await client.close()
            raise StorageUnavailableError('Cannot connect to MongoDB') from error

        database = client.get_default_database(default=DEFAULT_DATABASE)
        try:
            await _prepare(database)
        except BaseException:
            await client.close()
            raise
        logger.debug('MongoDB collections, validators and indexes are ready')
        return cls(client, database)

    async def is_available(self) -> bool:
        try:
            await self._client.admin.command('ping')
        except PyMongoError:
            return False
        return True

    async def close(self) -> None:
        await self._client.close()


async def _prepare(database: AsyncDatabase[Document]) -> None:
    existing = set(await database.list_collection_names())
    for name, validator in VALIDATORS.items():
        if name in existing:
            await database.command('collMod', name, validator=validator, validationLevel='strict')
        else:
            await database.create_collection(name, validator=validator, validationLevel='strict')
    for name, indexes in INDEXES.items():
        await database[name].create_indexes(indexes)
```

## `web/.editorconfig`

```ini
root = true

[*]
charset = utf-8
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.ts]
quote_type = single
ij_typescript_use_double_quotes = false

[*.md]
max_line_length = off
trim_trailing_whitespace = false
```

## `web/.prettierrc`

```json
{
  "printWidth": 100,
  "singleQuote": true,
  "overrides": [
    {
      "files": "*.html",
      "options": {
        "parser": "angular"
      }
    }
  ]
}
```

## `web/.vscode/extensions.json`

```json
{
  "recommendations": ["angular.ng-template"]
}
```

## `web/.vscode/launch.json`

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "ng serve",
      "type": "chrome",
      "request": "launch",
      "preLaunchTask": "npm: dev",
      "url": "http://localhost:4200/"
    },
    {
      "name": "ng test",
      "type": "chrome",
      "request": "launch",
      "preLaunchTask": "npm: test",
      "url": "http://localhost:9876/debug.html"
    }
  ]
}
```

## `web/.vscode/tasks.json`

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "npm",
      "script": "dev",
      "isBackground": true,
      "problemMatcher": {
        "owner": "typescript",
        "pattern": "$tsc",
        "background": {
          "activeOnStart": true,
          "beginsPattern": {
            "regexp": "Changes detected"
          },
          "endsPattern": {
            "regexp": "bundle generation (complete|failed)"
          }
        }
      }
    },
    {
      "type": "npm",
      "script": "test",
      "isBackground": true,
      "problemMatcher": {
        "owner": "typescript",
        "pattern": "$tsc",
        "background": {
          "activeOnStart": true,
          "beginsPattern": {
            "regexp": "Changes detected"
          },
          "endsPattern": {
            "regexp": "bundle generation (complete|failed)"
          }
        }
      }
    }
  ]
}
```

## `web/angular.json`

```json
{
  "$schema": "./node_modules/@angular/cli/lib/config/schema.json",
  "version": 1,
  "cli": {
    "packageManager": "npm"
  },
  "newProjectRoot": "projects",
  "projects": {
    "web": {
      "projectType": "application",
      "schematics": {
        "@schematics/angular:component": {
          "skipTests": true
        },
        "@schematics/angular:directive": {
          "skipTests": true
        },
        "@schematics/angular:pipe": {
          "skipTests": true
        },
        "@schematics/angular:service": {
          "skipTests": true
        }
      },
      "root": "",
      "sourceRoot": "src",
      "prefix": "app",
      "architect": {
        "build": {
          "builder": "@angular/build:application",
          "options": {
            "browser": "src/main.ts",
            "tsConfig": "tsconfig.app.json",
            "assets": [
              {
                "glob": "**/*",
                "input": "public"
              }
            ],
            "styles": [
              "src/styles.css",
              {
                "input": "node_modules/swagger-ui-dist/swagger-ui.css",
                "bundleName": "swagger-ui",
                "inject": false
              }
            ],
            "allowedCommonJsDependencies": [
              "swagger-ui-dist"
            ]
          },
          "configurations": {
            "production": {
              "budgets": [
                {
                  "type": "initial",
                  "maximumWarning": "500kB",
                  "maximumError": "1MB"
                },
                {
                  "type": "anyComponentStyle",
                  "maximumWarning": "4kB",
                  "maximumError": "8kB"
                }
              ],
              "outputHashing": "all"
            },
            "development": {
              "optimization": false,
              "extractLicenses": false,
              "sourceMap": true
            }
          },
          "defaultConfiguration": "production"
        },
        "serve": {
          "builder": "@angular/build:dev-server",
          "configurations": {
            "production": {
              "buildTarget": "web:build:production"
            },
            "development": {
              "buildTarget": "web:build:development"
            }
          },
          "defaultConfiguration": "development",
          "options": {
            "proxyConfig": "proxy.conf.json"
          }
        },
        "test": {
          "builder": "@angular/build:unit-test",
          "options": {
            "tsConfig": "../tmp/tests/web/tsconfig.spec.json",
            "include": [
              "../../tmp/tests/web/unit/**/*.spec.ts",
              "../../tmp/tests/web/integration/**/*.spec.ts"
            ]
          }
        }
      }
    }
  }
}
```

## `web/package.json`

```json
{
  "name": "web",
  "version": "0.0.0",
  "scripts": {
    "ng": "ng",
    "dev": "ng serve",
    "build": "ng build",
    "watch": "ng build --watch --configuration development",
    "test": "ng test"
  },
  "private": true,
  "packageManager": "npm@11.13.0",
  "dependencies": {
    "@angular/common": "^22.2.0",
    "@angular/compiler": "^22.2.0",
    "@angular/core": "^22.2.0",
    "@angular/forms": "^22.2.0",
    "@angular/platform-browser": "^22.2.0",
    "@angular/router": "^22.2.0",
    "rxjs": "~7.8.0",
    "swagger-ui-dist": "^5.34.1",
    "tslib": "^2.3.0"
  },
  "devDependencies": {
    "@angular/build": "^22.2.2",
    "@angular/cli": "^22.2.2",
    "@angular/compiler-cli": "^22.2.0",
    "jsdom": "^30.0.0",
    "prettier": "^3.8.1",
    "typescript": "~6.0.2",
    "vitest": "^5.0.0"
  },
  "scarfSettings": {
    "enabled": false
  }
}
```

## `web/proxy.conf.json`

```json
{
  "/api": {
    "target": "http://localhost:8000"
  }
}
```

## `web/tsconfig.app.json`

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": []
  },
  "include": ["src/**/*.ts"]
}
```

## `web/tsconfig.json`

```json
{
  "compileOnSave": false,
  "compilerOptions": {
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "experimentalDecorators": true,
    "importHelpers": true,
    "target": "ES2022",
    "module": "preserve"
  },
  "angularCompilerOptions": {
    "enableI18nLegacyMessageIdFormat": false,
    "strictInjectionParameters": true,
    "strictInputAccessModifiers": true,
    "strictTemplates": true
  },
  "files": [],
  "references": [
    {
      "path": "./tsconfig.app.json"
    }
  ]
}
```

## `web/src/app/app.config.ts`

```typescript
import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(),
  ],
};
```

## `web/src/app/app.css`

```css
:host {
  display: block;
  min-height: 100dvh;
}
```

## `web/src/app/app.html`

```html
<router-outlet />
```

## `web/src/app/app.routes.ts`

```typescript
import { Routes } from '@angular/router';
import { Home } from './catalog/ui/home/home';
import { OperationTypeForm } from './catalog/ui/operation-type-form/operation-type-form';
import { OperationTypeList } from './catalog/ui/operation-type-list/operation-type-list';
import { PartForm } from './catalog/ui/part-form/part-form';
import { PartList } from './catalog/ui/part-list/part-list';
import { ProcessCardDetails } from './catalog/ui/process-card-details/process-card-details';
import { ProcessCardForm } from './catalog/ui/process-card-form/process-card-form';
import { ProcessCardList } from './catalog/ui/process-card-list/process-card-list';
import { Shell } from './catalog/ui/shell/shell';

const TITLE = 'Технологічні карти';

export const routes: Routes = [
  {
    path: '',
    component: Shell,
    children: [
      { path: '', pathMatch: 'full', component: Home, title: `Головна · ${TITLE}` },
      { path: 'process-cards', component: ProcessCardList, title: TITLE },
      { path: 'process-cards/new', component: ProcessCardForm, title: `Нова карта · ${TITLE}` },
      { path: 'process-cards/:id', component: ProcessCardDetails, title: `Карта · ${TITLE}` },
      {
        path: 'process-cards/:id/edit',
        component: ProcessCardForm,
        title: `Редагування карти · ${TITLE}`,
      },
      { path: 'parts', component: PartList, title: `Деталі · ${TITLE}` },
      { path: 'parts/new', component: PartForm, title: `Нова деталь · ${TITLE}` },
      { path: 'parts/:id/edit', component: PartForm, title: `Редагування деталі · ${TITLE}` },
      { path: 'operation-types', component: OperationTypeList, title: `Види обробки · ${TITLE}` },
      {
        path: 'operation-types/new',
        component: OperationTypeForm,
        title: `Новий вид обробки · ${TITLE}`,
      },
      {
        path: 'operation-types/:id/edit',
        component: OperationTypeForm,
        title: `Редагування виду обробки · ${TITLE}`,
      },
      {
        path: 'docs',
        loadComponent: () => import('./catalog/ui/api-docs/api-docs').then((m) => m.ApiDocs),
        title: `API · ${TITLE}`,
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
```

## `web/src/app/app.ts`

```typescript
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {}
```

## `web/src/app/catalog/data-access/api-errors.ts`

```typescript
import { HttpErrorResponse } from '@angular/common/http';
import type { ErrorCode, ErrorResponse } from './contract';

const MESSAGES: Readonly<Record<ErrorCode, string>> = {
  VALIDATION_ERROR: 'Сервер не прийняв дані. Перевірте правильність заповнення полів',
  NOT_FOUND: 'Запис не знайдено. Можливо, його вже видалили',
  METHOD_NOT_ALLOWED: 'Цей метод не підтримується для цього ресурсу',
  PART_DESIGNATION_TAKEN: 'Деталь з таким позначенням уже існує',
  OPERATION_TYPE_NAME_TAKEN: 'Вид обробки з такою назвою вже існує',
  PART_ALREADY_HAS_CARD: 'Для цієї деталі вже створено технологічну карту',
  PART_IN_USE: 'Деталь має технологічну карту. Спершу видаліть карту',
  OPERATION_TYPE_IN_USE: 'Вид обробки використовується в технологічних картах',
  UNKNOWN_PART: 'Обрану деталь не знайдено. Оновіть сторінку',
  UNKNOWN_OPERATION_TYPE: 'Один із видів обробки не знайдено. Оновіть сторінку',
  DATABASE_UNAVAILABLE: 'База даних тимчасово недоступна. Спробуйте за кілька секунд',
  INTERNAL_ERROR: 'Помилка сервера. Спробуйте ще раз',
};

export function apiErrorCode(error: unknown): ErrorCode | null {
  if (!(error instanceof HttpErrorResponse)) {
    return null;
  }
  const body = error.error as Partial<ErrorResponse> | null;
  const code = body?.error?.code;
  return code !== undefined && code in MESSAGES ? code : null;
}

export function describeApiError(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 0) {
    return 'Сервер недоступний. Перевірте, чи запущений API';
  }
  const code = apiErrorCode(error);
  return code ? MESSAGES[code] : 'Щось пішло не так. Спробуйте ще раз';
}
```

## `web/src/app/catalog/data-access/catalog-api.ts`

```typescript
import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  OperationTypeRequest,
  OperationTypeResponse,
  PartRequest,
  PartResponse,
  ProcessCardRequest,
  ProcessCardResponse,
} from './contract';

export const API = {
  health: '/api/health',
  statistics: '/api/statistics',
  parts: '/api/parts',
  operationTypes: '/api/operation-types',
  processCards: '/api/process-cards',
  openApi: '/api/openapi.json',
} as const;

export function resourceUrl(collection: string, id: string): string {
  return `${collection}/${encodeURIComponent(id)}`;
}

@Injectable({ providedIn: 'root' })
export class CatalogApi {
  readonly #http = inject(HttpClient);

  savePart(id: string | null, part: PartRequest): Promise<PartResponse> {
    return this.#save<PartResponse>(API.parts, id, part);
  }

  deletePart(id: string): Promise<void> {
    return this.#delete(API.parts, id);
  }

  saveOperationType(
    id: string | null,
    operationType: OperationTypeRequest,
  ): Promise<OperationTypeResponse> {
    return this.#save<OperationTypeResponse>(API.operationTypes, id, operationType);
  }

  deleteOperationType(id: string): Promise<void> {
    return this.#delete(API.operationTypes, id);
  }

  saveProcessCard(
    id: string | null,
    processCard: ProcessCardRequest,
  ): Promise<ProcessCardResponse> {
    return this.#save<ProcessCardResponse>(API.processCards, id, processCard);
  }

  deleteProcessCard(id: string): Promise<void> {
    return this.#delete(API.processCards, id);
  }

  #save<T>(collection: string, id: string | null, body: object): Promise<T> {
    return firstValueFrom(
      id === null
        ? this.#http.post<T>(collection, body)
        : this.#http.put<T>(resourceUrl(collection, id), body),
    );
  }

  async #delete(collection: string, id: string): Promise<void> {
    await firstValueFrom(this.#http.delete(resourceUrl(collection, id)));
  }
}
```

## `web/src/app/catalog/data-access/contract.ts`

```typescript
export type * from '../../../../../contracts/api.contract';
```

## `web/src/app/catalog/data-access/form-errors.ts`

```typescript
import type { FieldTree } from '@angular/forms/signals';

export function firstError<T>(field: FieldTree<T>): string | null {
  const state = field();
  return state.touched() && state.invalid() ? (state.errors()[0]?.message ?? null) : null;
}

export function normalizedLength(value: string): number {
  return value.trim().replace(/\s+/gu, ' ').length;
}
```

## `web/src/app/catalog/data-access/format.ts`

```typescript
const MINUTES = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 });

export function formatDuration(minutes: number): string {
  const tenths = Math.round(minutes * 10);
  const hours = Math.floor(tenths / 600);
  const rest = (tenths - hours * 600) / 10;
  if (hours === 0) {
    return `${MINUTES.format(rest)} хв`;
  }
  return rest === 0 ? `${hours} год` : `${hours} год ${MINUTES.format(rest)} хв`;
}

export function formatMinutes(minutes: number): string {
  return MINUTES.format(minutes);
}

export function formatOperationNumber(number: number): string {
  return String(number).padStart(3, '0');
}

export function sumMinutes(durations: readonly (number | null)[]): number {
  return (
    durations.reduce<number>((total, minutes) => total + Math.round((minutes ?? 0) * 10), 0) / 10
  );
}

export function pluralize(count: number, forms: readonly [string, string, string]): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return `${count} ${forms[0]}`;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} ${forms[1]}`;
  }
  return `${count} ${forms[2]}`;
}
```

## `web/src/app/catalog/data-access/rules.ts`

```typescript
export const PART_DESIGNATION_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}./-]{1,38}[\p{L}\p{N}]$/u;
export const PART_DESIGNATION_HINT =
  '3–40 символів: літери, цифри, крапка, дефіс або скісна риска, наприклад КПІ.301.011';
export const PART_NAME_LENGTH = { min: 2, max: 120 } as const;
export const PART_MATERIAL_MAX_LENGTH = 80;

export const OPERATION_TYPE_NAME_LENGTH = { min: 2, max: 60 } as const;
export const OPERATION_TYPE_DESCRIPTION_MAX_LENGTH = 300;

export const OPERATIONS_MAX = 30;
export const DURATION_MINUTES = { min: 0.1, max: 1440 } as const;
export const DURATION_HINT = 'від 0,1 до 1440 хв, з точністю до 0,1';
export const EQUIPMENT_MAX_LENGTH = 120;

export function isTenthOfMinute(minutes: number): boolean {
  const tenths = minutes * 10;
  return Math.abs(tenths - Math.round(tenths)) < 1e-9;
}
```

## `web/src/app/catalog/data-access/swagger-ui.ts`

```typescript
import { InjectionToken } from '@angular/core';

export interface SwaggerUiOptions {
  readonly domNode: HTMLElement;
  readonly url: string;
  readonly onComplete: () => void;
  readonly [option: string]: unknown;
}

export type SwaggerUiRenderer = (options: SwaggerUiOptions) => unknown;

export const SWAGGER_UI_STYLESHEET = 'swagger-ui.css';

export const SWAGGER_UI = new InjectionToken<() => Promise<SwaggerUiRenderer>>('SWAGGER_UI', {
  providedIn: 'root',
  factory: () => async () => (await import('swagger-ui-dist/swagger-ui-es-bundle.js')).default,
});
```

## `web/src/app/catalog/ui/api-docs/api-docs.css`

```css
app-api-docs {
  display: block;
}

app-api-docs .swagger {
  color-scheme: light;
  overflow-x: auto;
  padding: 0.25rem 0.5rem;
  background: #ffffff;
  border: 1px solid var(--border);
  border-radius: 10px;
}

app-api-docs .swagger .swagger-ui,
app-api-docs .swagger .swagger-ui .info .title,
app-api-docs .swagger .swagger-ui .opblock-tag,
app-api-docs .swagger .swagger-ui .opblock .opblock-summary-description {
  font-family: inherit;
}

app-api-docs .swagger .swagger-ui .wrapper {
  max-width: none;
  padding: 0 0.75rem;
}

app-api-docs .swagger .swagger-ui .info {
  margin: 1rem 0;
}

app-api-docs .swagger .swagger-ui .info .title small pre {
  background: none;
}

app-api-docs .swagger .swagger-ui .btn.execute {
  background: #3f5bd8;
  border-color: #3f5bd8;
}
```

## `web/src/app/catalog/ui/api-docs/api-docs.html`

```html
<section class="panel" aria-labelledby="api-title">
  <div class="panel-header">
    <div>
      <p class="eyebrow">OpenAPI 3.1 · Swagger UI</p>
      <h1 id="api-title">API</h1>
      <p class="meta">
        Інтерактивна документація REST API, яку FastAPI будує автоматично з моделей Pydantic.
        Розгорніть запит, натисніть «Try it out», змініть параметри чи тіло й надішліть запит
        кнопкою «Execute»: відповідь сервера з’явиться нижче.
      </p>
    </div>
    <a class="button ghost small" [href]="openApiUrl" target="_blank" rel="noopener">
      openapi.json
    </a>
  </div>

  @switch (state()) {
    @case ('loading') {
      <p class="muted" role="status">Завантаження документації…</p>
    }
    @case ('failed') {
      <p class="error" role="alert">Не вдалося завантажити Swagger UI. Оновіть сторінку.</p>
    }
  }

  <div #swagger class="swagger" [hidden]="state() !== 'ready'"></div>
</section>
```

## `web/src/app/catalog/ui/api-docs/api-docs.ts`

```typescript
import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import { API } from '../../data-access/catalog-api';
import { SWAGGER_UI, SWAGGER_UI_STYLESHEET } from '../../data-access/swagger-ui';

const STYLESHEET_ID = 'swagger-ui-stylesheet';

@Component({
  selector: 'app-api-docs',
  templateUrl: './api-docs.html',
  styleUrl: './api-docs.css',
  encapsulation: ViewEncapsulation.None,
})
export class ApiDocs {
  readonly #document = inject(DOCUMENT);
  readonly #loadSwaggerUi = inject(SWAGGER_UI);
  private readonly container = viewChild.required<ElementRef<HTMLElement>>('swagger');

  protected readonly openApiUrl = API.openApi;
  protected readonly state = signal<'loading' | 'ready' | 'failed'>('loading');

  constructor() {
    afterNextRender(() => void this.#render());
  }

  async #render(): Promise<void> {
    this.#attachStylesheet();
    try {
      const render = await this.#loadSwaggerUi();
      render({
        domNode: this.container().nativeElement,
        url: API.openApi,
        deepLinking: false,
        tryItOutEnabled: true,
        displayRequestDuration: true,
        displayOperationId: true,
        docExpansion: 'list',
        defaultModelsExpandDepth: 0,
        defaultModelExpandDepth: 3,
        onComplete: () => this.state.set('ready'),
      });
    } catch {
      this.state.set('failed');
    }
  }

  #attachStylesheet(): void {
    if (this.#document.getElementById(STYLESHEET_ID)) {
      return;
    }
    const link = this.#document.createElement('link');
    link.id = STYLESHEET_ID;
    link.rel = 'stylesheet';
    link.href = SWAGGER_UI_STYLESHEET;
    this.#document.head.append(link);
  }
}
```

## `web/src/app/catalog/ui/home/home.css`

```css
:host {
  display: block;
}

.intro {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 1.25rem;
}

h1 {
  margin: 0;
  font-size: 1.6rem;
}

.lead {
  max-width: 46rem;
  margin: 0.5rem 0 0;
  color: var(--muted);
}

.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
  gap: 1rem;
}

.tile {
  display: grid;
  gap: 0.2rem;
  padding: 1rem 1.25rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  color: inherit;
  text-decoration: none;
}

.tile:hover {
  border-color: var(--accent);
}

.tile .value {
  font-size: 1.5rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.tile .label {
  color: var(--muted);
  font-size: 0.85rem;
}

.bars {
  display: grid;
  gap: 0.65rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.bars li {
  display: grid;
  grid-template-columns: 9rem minmax(0, 1fr) 13rem;
  align-items: center;
  gap: 1rem;
}

.bars li.empty {
  display: block;
}

.name {
  font-weight: 600;
}

.bar {
  height: 0.6rem;
  overflow: hidden;
  background: var(--surface-2);
  border-radius: 999px;
}

.bar span {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: inherit;
}

.amount {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 720px) {
  .intro {
    grid-template-columns: minmax(0, 1fr);
  }

  .bars li {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.35rem 1rem;
  }

  .bar {
    grid-column: 1 / -1;
    grid-row: 2;
  }
}
```

## `web/src/app/catalog/ui/home/home.html`

```html
<div class="page">
  <section class="panel intro" aria-labelledby="home-title">
    <div>
      <p class="eyebrow">REST API · FastAPI · MongoDB</p>
      <h1 id="home-title">Технологічні карти деталей</h1>
      <p class="lead">
        Технологічна карта описує маршрут обробки деталі: послідовність операцій із видом обробки,
        обладнанням і тривалістю. Дані зберігаються в MongoDB, а клієнт працює з ними через REST API
        на FastAPI з повним циклом CRUD. Усі запити можна переглянути й випробувати на сторінці
        «API».
      </p>
    </div>
    <div class="toolbar">
      <a class="button" routerLink="/process-cards/new">Нова технологічна карта</a>
      <a class="button secondary" routerLink="/parts/new">Додати деталь</a>
      <a class="button secondary" routerLink="/docs">Відкрити API</a>
    </div>
  </section>

  @if (loadError(); as error) {
    <p class="error" role="alert">{{ error }}</p>
  }

  <section class="tiles" aria-label="Показники">
    @for (tile of tiles(); track tile.label) {
      <a class="tile" [routerLink]="tile.link">
        <span class="value">{{ tile.value }}</span>
        <span class="label">{{ tile.label }}</span>
      </a>
    }
  </section>

  <section class="panel" aria-labelledby="workload-title">
    <div class="panel-header">
      <div>
        <h2 id="workload-title">Трудомісткість за видами обробки</h2>
        <p class="meta">
          Сума тривалості операцій у всіх картах, яку рахує агрегація MongoDB (GET /api/statistics)
        </p>
      </div>
      <button
        type="button"
        class="ghost small"
        [disabled]="statistics.isLoading()"
        (click)="statistics.reload()"
      >
        Оновити
      </button>
    </div>

    <ul class="bars">
      @for (entry of workload(); track entry.id) {
        <li>
          <span class="name">{{ entry.name }}</span>
          <span class="bar" aria-hidden="true"><span [style.width.%]="entry.share"></span></span>
          <span class="amount">
            {{ entry.duration }} <span class="muted">· {{ entry.operations }}</span>
          </span>
        </li>
      } @empty {
        <li class="empty">
          {{ statistics.isLoading() ? 'Завантаження…' : 'Видів обробки ще немає' }}
        </li>
      }
    </ul>
  </section>
</div>
```

## `web/src/app/catalog/ui/home/home.ts`

```typescript
import { httpResource } from '@angular/common/http';
import { Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { describeApiError } from '../../data-access/api-errors';
import { API } from '../../data-access/catalog-api';
import type { StatisticsResponse } from '../../data-access/contract';
import { formatDuration, pluralize } from '../../data-access/format';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  protected readonly statistics = httpResource<StatisticsResponse>(() => API.statistics);

  protected readonly loadError = computed(() => {
    const error = this.statistics.error();
    return error ? describeApiError(error) : null;
  });

  protected readonly tiles = computed(() => {
    const value = this.statistics.hasValue() ? this.statistics.value() : null;
    const count = (pick: (statistics: StatisticsResponse) => number) =>
      value ? String(pick(value)) : '—';
    return [
      { label: 'Технологічні карти', value: count((s) => s.processCards), link: '/process-cards' },
      { label: 'Деталі', value: count((s) => s.parts), link: '/parts' },
      { label: 'Види обробки', value: count((s) => s.operationTypes), link: '/operation-types' },
      { label: 'Операції в картах', value: count((s) => s.operations), link: '/process-cards' },
      {
        label: 'Сумарна тривалість',
        value: value ? formatDuration(value.totalDurationMinutes) : '—',
        link: '/process-cards',
      },
    ];
  });

  protected readonly workload = computed(() => {
    if (!this.statistics.hasValue()) {
      return [];
    }
    const entries = this.statistics.value().workload;
    const longest = Math.max(0, ...entries.map((entry) => entry.totalDurationMinutes));
    return entries.map((entry) => ({
      id: entry.operationType.id,
      name: entry.operationType.name,
      operations: pluralize(entry.operations, ['операція', 'операції', 'операцій']),
      duration: formatDuration(entry.totalDurationMinutes),
      share: longest > 0 ? (entry.totalDurationMinutes / longest) * 100 : 0,
    }));
  });
}
```

## `web/src/app/catalog/ui/operation-type-form/operation-type-form.html`

```html
<section class="panel" aria-labelledby="type-form-title">
  <div class="panel-header">
    <div>
      <p class="eyebrow">Види обробки</p>
      <h1 id="type-form-title">
        {{ isEdit() ? 'Редагування виду обробки' : 'Новий вид обробки' }}
      </h1>
      <p class="meta">
        {{ isEdit() ? 'PUT /api/operation-types/:id' : 'POST /api/operation-types' }}
      </p>
    </div>
  </div>

  @if (loadError(); as error) {
    <p class="error" role="alert">{{ error }}</p>
  } @else if (!ready()) {
    <p class="muted" role="status">Завантаження…</p>
  } @else {
    <form class="form" [formRoot]="form" novalidate>
      <div class="field">
        <label for="name">Назва</label>
        <input
          id="name"
          autocomplete="off"
          placeholder="Токарна"
          [formField]="form.name"
          [attr.aria-invalid]="errorOf(form.name) !== null"
        />
        @if (errorOf(form.name); as error) {
          <p class="error" role="alert">{{ error }}</p>
        } @else {
          <p class="hint">Перша літера стане великою, назва має бути унікальною.</p>
        }
      </div>

      <div class="field">
        <label for="description">Опис <span class="muted">(необов’язково)</span></label>
        <textarea
          id="description"
          placeholder="Обробка поверхонь обертання різцями на токарному верстаті"
          [formField]="form.description"
          [attr.aria-invalid]="errorOf(form.description) !== null"
        ></textarea>
        @if (errorOf(form.description); as error) {
          <p class="error" role="alert">{{ error }}</p>
        } @else {
          <p class="hint">До {{ descriptionLimit }} символів.</p>
        }
      </div>

      @if (serverError(); as error) {
        <p class="error" role="alert">{{ error }}</p>
      }

      <div class="form-actions">
        <button type="submit" [disabled]="form().submitting()">
          {{ isEdit() ? 'Зберегти зміни' : 'Додати вид обробки' }}
        </button>
        <a class="button ghost" routerLink="/operation-types">Скасувати</a>
      </div>
    </form>
  }
</section>
```

## `web/src/app/catalog/ui/operation-type-form/operation-type-form.ts`

```typescript
import { httpResource } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { form, FormField, FormRoot, maxLength, required, validate } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { describeApiError } from '../../data-access/api-errors';
import { API, CatalogApi, resourceUrl } from '../../data-access/catalog-api';
import type { OperationTypeResponse } from '../../data-access/contract';
import { firstError, normalizedLength } from '../../data-access/form-errors';
import {
  OPERATION_TYPE_DESCRIPTION_MAX_LENGTH,
  OPERATION_TYPE_NAME_LENGTH,
} from '../../data-access/rules';

@Component({
  selector: 'app-operation-type-form',
  imports: [FormField, FormRoot, RouterLink],
  templateUrl: './operation-type-form.html',
})
export class OperationTypeForm {
  readonly id = input<string>();

  readonly #api = inject(CatalogApi);
  readonly #router = inject(Router);

  protected readonly errorOf = firstError;
  protected readonly descriptionLimit = OPERATION_TYPE_DESCRIPTION_MAX_LENGTH;
  protected readonly isEdit = computed(() => this.id() !== undefined);
  protected readonly existing = httpResource<OperationTypeResponse>(() => {
    const id = this.id();
    return id === undefined ? undefined : resourceUrl(API.operationTypes, id);
  });
  protected readonly loadError = computed(() => {
    const error = this.existing.error();
    return error ? describeApiError(error) : null;
  });
  protected readonly ready = computed(() => !this.isEdit() || this.existing.hasValue());
  protected readonly serverError = signal<string | null>(null);

  readonly #model = signal({ name: '', description: '' });

  protected readonly form = form(
    this.#model,
    (path) => {
      required(path.name, { message: 'Вкажіть назву виду обробки' });
      validate(path.name, ({ value }) => {
        const length = normalizedLength(value());
        const { min, max } = OPERATION_TYPE_NAME_LENGTH;
        return length === 0 || (length >= min && length <= max)
          ? undefined
          : { kind: 'length', message: `Від ${min} до ${max} символів` };
      });
      maxLength(path.description, OPERATION_TYPE_DESCRIPTION_MAX_LENGTH, {
        message: `Не більше ${OPERATION_TYPE_DESCRIPTION_MAX_LENGTH} символів`,
      });
    },
    {
      submission: {
        action: async (field) => {
          const { name, description } = field().value();
          this.serverError.set(null);
          try {
            await this.#api.saveOperationType(this.id() ?? null, {
              name: name.trim(),
              description: description.trim() === '' ? null : description.trim(),
            });
            await this.#router.navigateByUrl('/operation-types');
          } catch (error) {
            this.serverError.set(describeApiError(error));
          }
          return undefined;
        },
      },
    },
  );

  constructor() {
    effect(() => {
      if (this.existing.hasValue()) {
        const { operationType } = this.existing.value();
        untracked(() =>
          this.#model.set({
            name: operationType.name,
            description: operationType.description ?? '',
          }),
        );
      }
    });
  }
}
```

## `web/src/app/catalog/ui/operation-type-list/operation-type-list.html`

```html
<section class="panel" aria-labelledby="types-title">
  <div class="panel-header">
    <div>
      <h1 id="types-title">Види обробки</h1>
      <p class="meta">
        GET і POST /api/operation-types · GET, PUT і DELETE /api/operation-types/:id
      </p>
    </div>
    <div class="toolbar">
      <button
        type="button"
        class="ghost small"
        [disabled]="operationTypes.isLoading()"
        (click)="reload()"
      >
        Оновити
      </button>
      <a class="button small" routerLink="/operation-types/new">Додати вид обробки</a>
    </div>
  </div>

  @if (loadError(); as error) {
    <p class="error" role="alert">{{ error }}</p>
  }
  @if (actionError(); as error) {
    <p class="error" role="alert">{{ error }}</p>
  }

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th scope="col">Назва</th>
          <th scope="col">Опис</th>
          <th scope="col" class="num">Операцій у картах</th>
          <th scope="col" class="num">Загальна тривалість</th>
          <th scope="col"><span class="visually-hidden">Дії</span></th>
        </tr>
      </thead>
      <tbody>
        @for (row of rows(); track row.operationType.id) {
          <tr [attr.aria-busy]="busyId() === row.operationType.id">
            <td>
              <strong>{{ row.operationType.name }}</strong>
            </td>
            <td class="muted">{{ row.operationType.description ?? '—' }}</td>
            <td class="num">{{ row.operations ?? '—' }}</td>
            <td class="num">{{ row.duration }}</td>
            <td class="actions">
              <a
                class="button ghost small"
                [routerLink]="['/operation-types', row.operationType.id, 'edit']"
              >
                Редагувати
              </a>
              <button
                type="button"
                class="ghost small danger"
                [disabled]="busyId() !== null || (row.operations ?? 0) > 0"
                [attr.title]="
                  (row.operations ?? 0) > 0
                    ? 'Вид обробки використовується в технологічних картах'
                    : null
                "
                (click)="remove(row.operationType)"
              >
                Видалити
              </button>
            </td>
          </tr>
        } @empty {
          <tr>
            <td colspan="5" class="empty">
              {{ operationTypes.isLoading() ? 'Завантаження…' : 'Видів обробки ще немає' }}
            </td>
          </tr>
        }
      </tbody>
    </table>
  </div>

  <p class="hint">
    Назва унікальна без урахування регістру. Вид обробки, який використовується в операціях карт, не
    можна видалити.
  </p>
</section>
```

## `web/src/app/catalog/ui/operation-type-list/operation-type-list.ts`

```typescript
import { httpResource } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { describeApiError } from '../../data-access/api-errors';
import { API, CatalogApi } from '../../data-access/catalog-api';
import type {
  OperationTypeDto,
  OperationTypesResponse,
  StatisticsResponse,
} from '../../data-access/contract';
import { formatDuration } from '../../data-access/format';

@Component({
  selector: 'app-operation-type-list',
  imports: [RouterLink],
  templateUrl: './operation-type-list.html',
})
export class OperationTypeList {
  readonly #api = inject(CatalogApi);

  protected readonly operationTypes = httpResource<OperationTypesResponse>(
    () => API.operationTypes,
  );
  protected readonly statistics = httpResource<StatisticsResponse>(() => API.statistics);
  protected readonly busyId = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);

  protected readonly rows = computed(() => {
    const types = this.operationTypes.hasValue() ? this.operationTypes.value().operationTypes : [];
    const workload = this.statistics.hasValue() ? this.statistics.value().workload : [];
    const usage = new Map(workload.map((entry) => [entry.operationType.id, entry]));
    return types.map((operationType) => {
      const entry = usage.get(operationType.id);
      return {
        operationType,
        operations: entry?.operations ?? null,
        duration: entry ? formatDuration(entry.totalDurationMinutes) : '—',
      };
    });
  });

  protected readonly loadError = computed(() => {
    const error = this.operationTypes.error() ?? this.statistics.error();
    return error ? describeApiError(error) : null;
  });

  protected reload(): void {
    this.operationTypes.reload();
    this.statistics.reload();
  }

  protected async remove(operationType: OperationTypeDto): Promise<void> {
    if (!confirm(`Видалити вид обробки «${operationType.name}»?`)) {
      return;
    }
    this.busyId.set(operationType.id);
    this.actionError.set(null);
    try {
      await this.#api.deleteOperationType(operationType.id);
    } catch (error) {
      this.actionError.set(describeApiError(error));
    } finally {
      this.busyId.set(null);
      this.reload();
    }
  }
}
```

## `web/src/app/catalog/ui/part-form/part-form.html`

```html
<section class="panel" aria-labelledby="part-form-title">
  <div class="panel-header">
    <div>
      <p class="eyebrow">Деталі</p>
      <h1 id="part-form-title">{{ isEdit() ? 'Редагування деталі' : 'Нова деталь' }}</h1>
      <p class="meta">{{ isEdit() ? 'PUT /api/parts/:id' : 'POST /api/parts' }}</p>
    </div>
  </div>

  @if (loadError(); as error) {
    <p class="error" role="alert">{{ error }}</p>
  } @else if (!ready()) {
    <p class="muted" role="status">Завантаження…</p>
  } @else {
    <form class="form" [formRoot]="form" novalidate>
      <div class="field">
        <label for="designation">Позначення (креслярський номер)</label>
        <input
          id="designation"
          class="code"
          autocomplete="off"
          placeholder="КПІ.301.011"
          [formField]="form.designation"
          [attr.aria-invalid]="errorOf(form.designation) !== null"
        />
        @if (errorOf(form.designation); as error) {
          <p class="error" role="alert">{{ error }}</p>
        } @else {
          <p class="hint">{{ designationHint }}. Літери буде переведено у верхній регістр.</p>
        }
      </div>

      <div class="field">
        <label for="name">Найменування</label>
        <input
          id="name"
          autocomplete="off"
          placeholder="Вал ведучий"
          [formField]="form.name"
          [attr.aria-invalid]="errorOf(form.name) !== null"
        />
        @if (errorOf(form.name); as error) {
          <p class="error" role="alert">{{ error }}</p>
        }
      </div>

      <div class="field">
        <label for="material">Матеріал <span class="muted">(необов’язково)</span></label>
        <input
          id="material"
          autocomplete="off"
          placeholder="Сталь 45"
          [formField]="form.material"
          [attr.aria-invalid]="errorOf(form.material) !== null"
        />
        @if (errorOf(form.material); as error) {
          <p class="error" role="alert">{{ error }}</p>
        }
      </div>

      @if (serverError(); as error) {
        <p class="error" role="alert">{{ error }}</p>
      }

      <div class="form-actions">
        <button type="submit" [disabled]="form().submitting()">
          {{ isEdit() ? 'Зберегти зміни' : 'Додати деталь' }}
        </button>
        <a class="button ghost" routerLink="/parts">Скасувати</a>
      </div>
    </form>
  }
</section>
```

## `web/src/app/catalog/ui/part-form/part-form.ts`

```typescript
import { httpResource } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { form, FormField, FormRoot, maxLength, required, validate } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { describeApiError } from '../../data-access/api-errors';
import { API, CatalogApi, resourceUrl } from '../../data-access/catalog-api';
import type { PartResponse } from '../../data-access/contract';
import { firstError, normalizedLength } from '../../data-access/form-errors';
import {
  PART_DESIGNATION_HINT,
  PART_DESIGNATION_PATTERN,
  PART_MATERIAL_MAX_LENGTH,
  PART_NAME_LENGTH,
} from '../../data-access/rules';

@Component({
  selector: 'app-part-form',
  imports: [FormField, FormRoot, RouterLink],
  templateUrl: './part-form.html',
})
export class PartForm {
  readonly id = input<string>();

  readonly #api = inject(CatalogApi);
  readonly #router = inject(Router);

  protected readonly designationHint = PART_DESIGNATION_HINT;
  protected readonly errorOf = firstError;
  protected readonly isEdit = computed(() => this.id() !== undefined);
  protected readonly existing = httpResource<PartResponse>(() => {
    const id = this.id();
    return id === undefined ? undefined : resourceUrl(API.parts, id);
  });
  protected readonly loadError = computed(() => {
    const error = this.existing.error();
    return error ? describeApiError(error) : null;
  });
  protected readonly ready = computed(() => !this.isEdit() || this.existing.hasValue());
  protected readonly serverError = signal<string | null>(null);

  readonly #model = signal({ designation: '', name: '', material: '' });

  protected readonly form = form(
    this.#model,
    (path) => {
      required(path.designation, { message: 'Вкажіть позначення деталі' });
      validate(path.designation, ({ value }) =>
        value().trim() === '' || PART_DESIGNATION_PATTERN.test(value().trim())
          ? undefined
          : { kind: 'pattern', message: PART_DESIGNATION_HINT },
      );
      required(path.name, { message: 'Вкажіть найменування деталі' });
      validate(path.name, ({ value }) => {
        const length = normalizedLength(value());
        return length === 0 || (length >= PART_NAME_LENGTH.min && length <= PART_NAME_LENGTH.max)
          ? undefined
          : {
              kind: 'length',
              message: `Від ${PART_NAME_LENGTH.min} до ${PART_NAME_LENGTH.max} символів`,
            };
      });
      maxLength(path.material, PART_MATERIAL_MAX_LENGTH, {
        message: `Не більше ${PART_MATERIAL_MAX_LENGTH} символів`,
      });
    },
    {
      submission: {
        action: async (field) => {
          const { designation, name, material } = field().value();
          this.serverError.set(null);
          try {
            await this.#api.savePart(this.id() ?? null, {
              designation: designation.trim(),
              name: name.trim(),
              material: material.trim() === '' ? null : material.trim(),
            });
            await this.#router.navigateByUrl('/parts');
          } catch (error) {
            this.serverError.set(describeApiError(error));
          }
          return undefined;
        },
      },
    },
  );

  constructor() {
    effect(() => {
      if (this.existing.hasValue()) {
        const { part } = this.existing.value();
        untracked(() =>
          this.#model.set({
            designation: part.designation,
            name: part.name,
            material: part.material ?? '',
          }),
        );
      }
    });
  }
}
```

## `web/src/app/catalog/ui/part-list/part-list.html`

```html
<section class="panel" aria-labelledby="parts-title">
  <div class="panel-header">
    <div>
      <h1 id="parts-title">Деталі</h1>
      <p class="meta">GET і POST /api/parts · GET, PUT і DELETE /api/parts/:id</p>
    </div>
    <div class="toolbar">
      <button type="button" class="ghost small" [disabled]="parts.isLoading()" (click)="reload()">
        Оновити
      </button>
      <a class="button small" routerLink="/parts/new">Додати деталь</a>
    </div>
  </div>

  @if (loadError(); as error) {
    <p class="error" role="alert">{{ error }}</p>
  }
  @if (actionError(); as error) {
    <p class="error" role="alert">{{ error }}</p>
  }

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th scope="col">Позначення</th>
          <th scope="col">Найменування</th>
          <th scope="col">Матеріал</th>
          <th scope="col">Технологічна карта</th>
          <th scope="col">Оновлено</th>
          <th scope="col"><span class="visually-hidden">Дії</span></th>
        </tr>
      </thead>
      <tbody>
        @for (row of rows(); track row.part.id) {
          <tr [attr.aria-busy]="busyId() === row.part.id">
            <td class="code">{{ row.part.designation }}</td>
            <td>{{ row.part.name }}</td>
            <td>{{ row.part.material ?? '—' }}</td>
            <td>
              @if (row.cardId; as cardId) {
                <a [routerLink]="['/process-cards', cardId]">Відкрити карту</a>
              } @else {
                <a routerLink="/process-cards/new" [queryParams]="{ partId: row.part.id }">
                  Створити карту
                </a>
              }
            </td>
            <td>{{ row.part.updatedAt | date: 'dd.MM.yyyy HH:mm' }}</td>
            <td class="actions">
              <a class="button ghost small" [routerLink]="['/parts', row.part.id, 'edit']">
                Редагувати
              </a>
              <button
                type="button"
                class="ghost small danger"
                [disabled]="busyId() !== null || row.cardId !== null"
                [attr.title]="row.cardId ? 'Спершу видаліть технологічну карту деталі' : null"
                (click)="remove(row.part)"
              >
                Видалити
              </button>
            </td>
          </tr>
        } @empty {
          <tr>
            <td colspan="6" class="empty">
              {{ parts.isLoading() ? 'Завантаження…' : 'Деталей ще немає' }}
            </td>
          </tr>
        }
      </tbody>
    </table>
  </div>

  <p class="hint">
    Позначення деталі унікальне й не залежить від регістру. Деталь із технологічною картою не можна
    видалити, доки існує карта.
  </p>
</section>
```

## `web/src/app/catalog/ui/part-list/part-list.ts`

```typescript
import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { describeApiError } from '../../data-access/api-errors';
import { API, CatalogApi } from '../../data-access/catalog-api';
import type { PartDto, PartsResponse, ProcessCardsResponse } from '../../data-access/contract';

@Component({
  selector: 'app-part-list',
  imports: [DatePipe, RouterLink],
  templateUrl: './part-list.html',
})
export class PartList {
  readonly #api = inject(CatalogApi);

  protected readonly parts = httpResource<PartsResponse>(() => API.parts);
  protected readonly cards = httpResource<ProcessCardsResponse>(() => API.processCards);
  protected readonly busyId = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);

  protected readonly rows = computed(() => {
    const parts = this.parts.hasValue() ? this.parts.value().parts : [];
    const cards = this.cards.hasValue() ? this.cards.value().processCards : [];
    const cardByPart = new Map(cards.map((card) => [card.part.id, card.id]));
    return parts.map((part) => ({ part, cardId: cardByPart.get(part.id) ?? null }));
  });

  protected readonly loadError = computed(() => {
    const error = this.parts.error() ?? this.cards.error();
    return error ? describeApiError(error) : null;
  });

  protected reload(): void {
    this.parts.reload();
    this.cards.reload();
  }

  protected async remove(part: PartDto): Promise<void> {
    if (!confirm(`Видалити деталь «${part.designation} ${part.name}»?`)) {
      return;
    }
    this.busyId.set(part.id);
    this.actionError.set(null);
    try {
      await this.#api.deletePart(part.id);
    } catch (error) {
      this.actionError.set(describeApiError(error));
    } finally {
      this.busyId.set(null);
      this.reload();
    }
  }
}
```

## `web/src/app/catalog/ui/process-card-details/process-card-details.css`

```css
:host {
  display: block;
}

h1 {
  font-size: 1.35rem;
}

h1 .code {
  font-size: 0.9em;
}

h2 {
  margin: 0;
  font-size: 1.1rem;
}

.summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 0.75rem;
  margin: 0;
}

.summary div {
  padding: 0.75rem 1rem;
  background: var(--surface-2);
  border-radius: 10px;
}

dt {
  color: var(--muted);
  font-size: 0.8rem;
}

dd {
  margin: 0.15rem 0 0;
  font-weight: 600;
}

tfoot th,
tfoot td {
  border-bottom: 0;
}

tfoot th {
  color: var(--text);
  font-size: 0.9rem;
  letter-spacing: normal;
  text-transform: none;
}

.share {
  width: 20%;
  min-width: 7rem;
  vertical-align: middle;
}

.bar {
  display: block;
  height: 0.5rem;
  overflow: hidden;
  background: var(--surface-2);
  border-radius: 999px;
}

.bar span {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: inherit;
}
```

## `web/src/app/catalog/ui/process-card-details/process-card-details.html`

```html
@if (loadError(); as error) {
  <section class="panel">
    <p class="error" role="alert">{{ error }}</p>
    <a routerLink="/process-cards">← До списку карт</a>
  </section>
} @else if (view(); as view) {
  <div class="page">
    <section class="panel" aria-labelledby="card-title">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Технологічна карта</p>
          <h1 id="card-title">
            <span class="code">{{ view.card.part.designation }}</span> · {{ view.card.part.name }}
          </h1>
          <p class="meta">GET /api/process-cards/{{ view.card.id }}</p>
        </div>
        <div class="toolbar">
          <a class="button ghost small" routerLink="/process-cards">До списку</a>
          <a class="button small" [routerLink]="['/process-cards', view.card.id, 'edit']">
            Редагувати
          </a>
          <button
            type="button"
            class="ghost small danger"
            [disabled]="busy()"
            (click)="remove(view.card)"
          >
            Видалити
          </button>
        </div>
      </div>

      @if (actionError(); as error) {
        <p class="error" role="alert">{{ error }}</p>
      }

      <dl class="summary">
        <div>
          <dt>Матеріал</dt>
          <dd>{{ view.card.part.material ?? '—' }}</dd>
        </div>
        <div>
          <dt>Операції</dt>
          <dd>{{ view.count }}</dd>
        </div>
        <div>
          <dt>Сумарна тривалість</dt>
          <dd>{{ view.total }}</dd>
        </div>
        <div>
          <dt>Оновлено</dt>
          <dd>{{ view.card.updatedAt | date: 'dd.MM.yyyy HH:mm' }}</dd>
        </div>
      </dl>
    </section>

    <section class="panel" aria-labelledby="route-title">
      <h2 id="route-title">Маршрут обробки</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">№</th>
              <th scope="col">Вид обробки</th>
              <th scope="col">Обладнання</th>
              <th scope="col" class="num">Тривалість, хв</th>
              <th scope="col">Частка часу</th>
            </tr>
          </thead>
          <tbody>
            @for (row of view.operations; track row.operation.number) {
              <tr>
                <td class="code">{{ row.number }}</td>
                <td>{{ row.operation.operationType.name }}</td>
                <td>{{ row.operation.equipment ?? '—' }}</td>
                <td class="num">{{ row.minutes }}</td>
                <td class="share">
                  <span class="bar" aria-hidden="true"
                    ><span [style.width.%]="row.share"></span
                  ></span>
                </td>
              </tr>
            }
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colspan="3">Разом</th>
              <td class="num">
                <strong>{{ view.totalMinutes }}</strong>
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  </div>
} @else {
  <p class="muted" role="status">Завантаження…</p>
}
```

## `web/src/app/catalog/ui/process-card-details/process-card-details.ts`

```typescript
import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { describeApiError } from '../../data-access/api-errors';
import { API, CatalogApi, resourceUrl } from '../../data-access/catalog-api';
import type { ProcessCardDto, ProcessCardResponse } from '../../data-access/contract';
import {
  formatDuration,
  formatMinutes,
  formatOperationNumber,
  pluralize,
} from '../../data-access/format';

@Component({
  selector: 'app-process-card-details',
  imports: [DatePipe, RouterLink],
  templateUrl: './process-card-details.html',
  styleUrl: './process-card-details.css',
})
export class ProcessCardDetails {
  readonly id = input.required<string>();

  readonly #api = inject(CatalogApi);
  readonly #router = inject(Router);

  protected readonly resource = httpResource<ProcessCardResponse>(() =>
    resourceUrl(API.processCards, this.id()),
  );
  protected readonly busy = signal(false);
  protected readonly actionError = signal<string | null>(null);

  protected readonly view = computed(() => {
    if (!this.resource.hasValue()) {
      return null;
    }
    const card = this.resource.value().processCard;
    const total = card.totalDurationMinutes;
    return {
      card,
      count: pluralize(card.operations.length, ['операція', 'операції', 'операцій']),
      total: formatDuration(total),
      totalMinutes: formatMinutes(total),
      operations: card.operations.map((operation) => ({
        operation,
        number: formatOperationNumber(operation.number),
        minutes: formatMinutes(operation.durationMinutes),
        share: total > 0 ? (operation.durationMinutes / total) * 100 : 0,
      })),
    };
  });

  protected readonly loadError = computed(() => {
    const error = this.resource.error();
    return error ? describeApiError(error) : null;
  });

  protected async remove(card: ProcessCardDto): Promise<void> {
    if (!confirm(`Видалити технологічну карту деталі «${card.part.designation}»?`)) {
      return;
    }
    this.busy.set(true);
    this.actionError.set(null);
    try {
      await this.#api.deleteProcessCard(card.id);
      await this.#router.navigateByUrl('/process-cards');
    } catch (error) {
      this.actionError.set(describeApiError(error));
    } finally {
      this.busy.set(false);
    }
  }
}
```

## `web/src/app/catalog/ui/process-card-form/process-card-form.css`

```css
.card-form {
  display: grid;
  gap: 1.25rem;
}

.part {
  max-width: 40rem;
}

.operations {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

legend {
  margin-bottom: 0.5rem;
  padding: 0;
  font-weight: 600;
}

td {
  vertical-align: top;
}

td input,
td select {
  padding: 0.45rem 0.6rem;
}

td .error {
  margin-top: 0.3rem;
  font-size: 0.8rem;
}

.number {
  padding-top: 1.15rem;
}

.type {
  min-width: 11rem;
}

.duration {
  width: 9rem;
  min-width: 7rem;
}

.actions {
  width: 1%;
}

.operations-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
```

## `web/src/app/catalog/ui/process-card-form/process-card-form.html`

```html
<section class="panel" aria-labelledby="card-form-title">
  <div class="panel-header">
    <div>
      <p class="eyebrow">Технологічні карти</p>
      <h1 id="card-form-title">
        {{ isEdit() ? 'Редагування технологічної карти' : 'Нова технологічна карта' }}
      </h1>
      <p class="meta">{{ isEdit() ? 'PUT /api/process-cards/:id' : 'POST /api/process-cards' }}</p>
    </div>
  </div>

  @if (loadError(); as error) {
    <p class="error" role="alert">{{ error }}</p>
  } @else if (!ready()) {
    <p class="muted" role="status">Завантаження…</p>
  } @else {
    <form class="card-form" [formRoot]="form" novalidate>
      <div class="field part">
        <label for="part">Деталь</label>
        <select
          id="part"
          [formField]="form.partId"
          [attr.aria-invalid]="errorOf(form.partId) !== null"
        >
          <option value="" disabled>Оберіть деталь…</option>
          @for (part of availableParts(); track part.id) {
            <option [value]="part.id">{{ part.designation }} — {{ part.name }}</option>
          }
        </select>
        @if (errorOf(form.partId); as error) {
          <p class="error" role="alert">{{ error }}</p>
        } @else if (availableParts().length === 0) {
          <p class="notice">
            Усі деталі вже мають технологічні карти.
            <a routerLink="/parts/new">Додайте нову деталь</a>.
          </p>
        } @else {
          <p class="hint">
            У списку лише деталі без технологічної карти.
            <a routerLink="/parts/new">Додати деталь</a>
          </p>
        }
      </div>

      <fieldset class="operations">
        <legend>Операції маршруту</legend>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">№</th>
                <th scope="col">Вид обробки</th>
                <th scope="col">Обладнання</th>
                <th scope="col">Тривалість, хв</th>
                <th scope="col"><span class="visually-hidden">Порядок і видалення</span></th>
              </tr>
            </thead>
            <tbody>
              @for (
                operation of form.operations;
                track $index;
                let index = $index, first = $first, last = $last
              ) {
                <tr>
                  <td class="code number">{{ numbers()[index] }}</td>
                  <td class="type">
                    <select
                      [formField]="operation.operationTypeId"
                      [attr.aria-label]="'Вид обробки операції ' + numbers()[index]"
                      [attr.aria-invalid]="errorOf(operation.operationTypeId) !== null"
                    >
                      <option value="" disabled>Оберіть…</option>
                      @for (type of types(); track type.id) {
                        <option [value]="type.id">{{ type.name }}</option>
                      }
                    </select>
                    @if (errorOf(operation.operationTypeId); as error) {
                      <p class="error">{{ error }}</p>
                    }
                  </td>
                  <td>
                    <input
                      autocomplete="off"
                      placeholder="Необов’язково"
                      [formField]="operation.equipment"
                      [attr.aria-label]="'Обладнання операції ' + numbers()[index]"
                      [attr.aria-invalid]="errorOf(operation.equipment) !== null"
                    />
                    @if (errorOf(operation.equipment); as error) {
                      <p class="error">{{ error }}</p>
                    }
                  </td>
                  <td class="duration">
                    <input
                      type="number"
                      step="0.1"
                      inputmode="decimal"
                      [formField]="operation.durationMinutes"
                      [attr.aria-label]="'Тривалість операції ' + numbers()[index] + ', хвилин'"
                      [attr.aria-invalid]="errorOf(operation.durationMinutes) !== null"
                    />
                    @if (errorOf(operation.durationMinutes); as error) {
                      <p class="error">{{ error }}</p>
                    }
                  </td>
                  <td class="actions">
                    <button
                      type="button"
                      class="ghost icon"
                      title="Перемістити вище"
                      aria-label="Перемістити вище"
                      [disabled]="first"
                      (click)="moveOperation(index, -1)"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      class="ghost icon"
                      title="Перемістити нижче"
                      aria-label="Перемістити нижче"
                      [disabled]="last"
                      (click)="moveOperation(index, 1)"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      class="ghost icon danger"
                      title="Видалити операцію"
                      aria-label="Видалити операцію"
                      (click)="removeOperation(index)"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="5" class="empty">Операцій ще немає</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (errorOf(form.operations); as error) {
          <p class="error" role="alert">{{ error }}</p>
        }

        <div class="operations-footer">
          <button
            type="button"
            class="secondary small"
            [disabled]="form.operations.length >= operationsMax"
            (click)="addOperation()"
          >
            + Додати операцію
          </button>
          <span>
            Сумарна тривалість: <strong>{{ total() }}</strong>
          </span>
        </div>
        <p class="hint">
          Тривалість {{ durationHint }}. Номери операцій (005, 010…) призначаються автоматично за
          порядком у маршруті.
        </p>
      </fieldset>

      @if (serverError(); as error) {
        <p class="error" role="alert">{{ error }}</p>
      }

      <div class="form-actions">
        <button type="submit" [disabled]="form().submitting()">
          {{ isEdit() ? 'Зберегти зміни' : 'Створити карту' }}
        </button>
        <a
          class="button ghost"
          [routerLink]="isEdit() ? ['/process-cards', id()] : ['/process-cards']"
        >
          Скасувати
        </a>
      </div>
    </form>
  }
</section>
```

## `web/src/app/catalog/ui/process-card-form/process-card-form.ts`

```typescript
import { httpResource } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import {
  applyEach,
  form,
  FormField,
  FormRoot,
  max,
  maxLength,
  min,
  required,
  validate,
} from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { describeApiError } from '../../data-access/api-errors';
import { API, CatalogApi, resourceUrl } from '../../data-access/catalog-api';
import type {
  OperationTypesResponse,
  PartsResponse,
  ProcessCardResponse,
  ProcessCardsResponse,
} from '../../data-access/contract';
import { firstError } from '../../data-access/form-errors';
import { formatDuration, formatOperationNumber, sumMinutes } from '../../data-access/format';
import {
  DURATION_HINT,
  DURATION_MINUTES,
  EQUIPMENT_MAX_LENGTH,
  isTenthOfMinute,
  OPERATIONS_MAX,
} from '../../data-access/rules';

interface OperationModel {
  readonly operationTypeId: string;
  readonly equipment: string;
  readonly durationMinutes: number | null;
}

interface ProcessCardModel {
  readonly partId: string;
  readonly operations: readonly OperationModel[];
}

const OPERATION_NUMBER_STEP = 5;

function emptyOperation(): OperationModel {
  return { operationTypeId: '', equipment: '', durationMinutes: null };
}

@Component({
  selector: 'app-process-card-form',
  imports: [FormField, FormRoot, RouterLink],
  templateUrl: './process-card-form.html',
  styleUrl: './process-card-form.css',
})
export class ProcessCardForm {
  readonly id = input<string>();
  readonly partId = input<string>();

  readonly #api = inject(CatalogApi);
  readonly #router = inject(Router);

  protected readonly errorOf = firstError;
  protected readonly durationHint = DURATION_HINT;
  protected readonly operationsMax = OPERATIONS_MAX;
  protected readonly isEdit = computed(() => this.id() !== undefined);

  protected readonly existing = httpResource<ProcessCardResponse>(() => {
    const id = this.id();
    return id === undefined ? undefined : resourceUrl(API.processCards, id);
  });
  protected readonly parts = httpResource<PartsResponse>(() => API.parts);
  protected readonly operationTypes = httpResource<OperationTypesResponse>(
    () => API.operationTypes,
  );
  protected readonly cards = httpResource<ProcessCardsResponse>(() => API.processCards);

  protected readonly ready = computed(
    () =>
      this.parts.hasValue() &&
      this.operationTypes.hasValue() &&
      this.cards.hasValue() &&
      (!this.isEdit() || this.existing.hasValue()),
  );
  protected readonly loadError = computed(() => {
    const error =
      this.existing.error() ??
      this.parts.error() ??
      this.operationTypes.error() ??
      this.cards.error();
    return error ? describeApiError(error) : null;
  });
  protected readonly availableParts = computed(() => {
    const parts = this.parts.hasValue() ? this.parts.value().parts : [];
    const cards = this.cards.hasValue() ? this.cards.value().processCards : [];
    const ownPart = this.existing.hasValue() ? this.existing.value().processCard.part.id : null;
    const taken = new Set(cards.map((card) => card.part.id));
    return parts.filter((part) => part.id === ownPart || !taken.has(part.id));
  });
  protected readonly types = computed(() =>
    this.operationTypes.hasValue() ? this.operationTypes.value().operationTypes : [],
  );
  protected readonly serverError = signal<string | null>(null);

  readonly #model = signal<ProcessCardModel>({ partId: '', operations: [emptyOperation()] });

  protected readonly numbers = computed(() =>
    this.#model().operations.map((_, index) =>
      formatOperationNumber((index + 1) * OPERATION_NUMBER_STEP),
    ),
  );
  protected readonly total = computed(() =>
    formatDuration(sumMinutes(this.#model().operations.map((item) => item.durationMinutes))),
  );

  protected readonly form = form(
    this.#model,
    (path) => {
      required(path.partId, { message: 'Оберіть деталь' });
      validate(path.operations, ({ value }) =>
        value().length === 0
          ? { kind: 'empty', message: 'Додайте хоча б одну операцію' }
          : undefined,
      );
      applyEach(path.operations, (operation) => {
        required(operation.operationTypeId, { message: 'Оберіть вид обробки' });
        maxLength(operation.equipment, EQUIPMENT_MAX_LENGTH, {
          message: `Не більше ${EQUIPMENT_MAX_LENGTH} символів`,
        });
        required(operation.durationMinutes, { message: 'Вкажіть тривалість' });
        min(operation.durationMinutes, DURATION_MINUTES.min, { message: DURATION_HINT });
        max(operation.durationMinutes, DURATION_MINUTES.max, { message: DURATION_HINT });
        validate(operation.durationMinutes, ({ value }) => {
          const minutes = value();
          return minutes === null || isTenthOfMinute(minutes)
            ? undefined
            : { kind: 'precision', message: 'Не більше одного знака після коми' };
        });
      });
    },
    {
      submission: {
        action: async (field) => {
          const { partId, operations } = field().value();
          this.serverError.set(null);
          try {
            const { processCard } = await this.#api.saveProcessCard(this.id() ?? null, {
              partId,
              operations: operations.map((operation) => ({
                operationTypeId: operation.operationTypeId,
                equipment: operation.equipment.trim() === '' ? null : operation.equipment.trim(),
                durationMinutes: operation.durationMinutes ?? 0,
              })),
            });
            await this.#router.navigate(['/process-cards', processCard.id]);
          } catch (error) {
            this.serverError.set(describeApiError(error));
          }
          return undefined;
        },
      },
    },
  );

  constructor() {
    effect(() => {
      if (this.existing.hasValue()) {
        const card = this.existing.value().processCard;
        untracked(() =>
          this.#model.set({
            partId: card.part.id,
            operations: card.operations.map((operation) => ({
              operationTypeId: operation.operationType.id,
              equipment: operation.equipment ?? '',
              durationMinutes: operation.durationMinutes,
            })),
          }),
        );
      }
    });
    effect(() => {
      const partId = this.partId();
      if (partId !== undefined && !this.isEdit()) {
        untracked(() => this.#model.update((model) => ({ ...model, partId })));
      }
    });
  }

  protected addOperation(): void {
    this.#model.update((model) =>
      model.operations.length >= OPERATIONS_MAX
        ? model
        : { ...model, operations: [...model.operations, emptyOperation()] },
    );
  }

  protected removeOperation(index: number): void {
    this.#model.update((model) => ({
      ...model,
      operations: model.operations.filter((_, position) => position !== index),
    }));
  }

  protected moveOperation(index: number, offset: -1 | 1): void {
    this.#model.update((model) => {
      const target = index + offset;
      const operations = [...model.operations];
      const [moved] = operations.splice(index, 1);
      if (moved === undefined || target < 0 || target > operations.length) {
        return model;
      }
      operations.splice(target, 0, moved);
      return { ...model, operations };
    });
  }
}
```

## `web/src/app/catalog/ui/process-card-list/process-card-list.css`

```css
.part {
  min-width: 11rem;
}

.part a,
.part span {
  display: block;
}

.part a {
  font-weight: 600;
  text-decoration: none;
}

.route {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.route li {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.82rem;
  white-space: nowrap;
}

.route li + li::before {
  content: '→';
  color: var(--muted);
}

.route span {
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  background: var(--surface-2);
}
```

## `web/src/app/catalog/ui/process-card-list/process-card-list.html`

```html
<section class="panel" aria-labelledby="cards-title">
  <div class="panel-header">
    <div>
      <h1 id="cards-title">Технологічні карти</h1>
      <p class="meta">GET і POST /api/process-cards · GET, PUT і DELETE /api/process-cards/:id</p>
    </div>
    <div class="toolbar">
      <button
        type="button"
        class="ghost small"
        [disabled]="cards.isLoading()"
        (click)="cards.reload()"
      >
        Оновити
      </button>
      <a class="button small" routerLink="/process-cards/new">Нова карта</a>
    </div>
  </div>

  @if (loadError(); as error) {
    <p class="error" role="alert">{{ error }}</p>
  }
  @if (actionError(); as error) {
    <p class="error" role="alert">{{ error }}</p>
  }

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th scope="col">Деталь</th>
          <th scope="col">Маршрут обробки</th>
          <th scope="col" class="num">Операцій</th>
          <th scope="col" class="num">Тривалість</th>
          <th scope="col">Оновлено</th>
          <th scope="col"><span class="visually-hidden">Дії</span></th>
        </tr>
      </thead>
      <tbody>
        @for (row of rows(); track row.card.id) {
          <tr [attr.aria-busy]="busyId() === row.card.id">
            <td class="part">
              <a class="code" [routerLink]="['/process-cards', row.card.id]">
                {{ row.card.part.designation }}
              </a>
              <span>{{ row.card.part.name }}</span>
            </td>
            <td>
              <ol class="route" [attr.aria-label]="'Маршрут: ' + row.route.join(', ')">
                @for (step of row.route; track $index) {
                  <li>
                    <span>{{ step }}</span>
                  </li>
                }
              </ol>
            </td>
            <td class="num">{{ row.card.operations.length }}</td>
            <td class="num">{{ row.duration }}</td>
            <td>{{ row.card.updatedAt | date: 'dd.MM.yyyy HH:mm' }}</td>
            <td class="actions">
              <a class="button ghost small" [routerLink]="['/process-cards', row.card.id, 'edit']">
                Редагувати
              </a>
              <button
                type="button"
                class="ghost small danger"
                [disabled]="busyId() !== null"
                (click)="remove(row.card)"
              >
                Видалити
              </button>
            </td>
          </tr>
        } @empty {
          <tr>
            <td colspan="6" class="empty">
              {{ cards.isLoading() ? 'Завантаження…' : 'Технологічних карт ще немає' }}
            </td>
          </tr>
        }
      </tbody>
    </table>
  </div>

  <p class="hint">
    Для кожної деталі існує не більше однієї технологічної карти. Операції нумеруються з кроком 5
    (005, 010, 015…), як у маршрутних картах.
  </p>
</section>
```

## `web/src/app/catalog/ui/process-card-list/process-card-list.ts`

```typescript
import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { describeApiError } from '../../data-access/api-errors';
import { API, CatalogApi } from '../../data-access/catalog-api';
import type { ProcessCardDto, ProcessCardsResponse } from '../../data-access/contract';
import { formatDuration } from '../../data-access/format';

@Component({
  selector: 'app-process-card-list',
  imports: [DatePipe, RouterLink],
  templateUrl: './process-card-list.html',
  styleUrl: './process-card-list.css',
})
export class ProcessCardList {
  readonly #api = inject(CatalogApi);

  protected readonly cards = httpResource<ProcessCardsResponse>(() => API.processCards);
  protected readonly busyId = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);

  protected readonly rows = computed(() =>
    (this.cards.hasValue() ? this.cards.value().processCards : []).map((card) => ({
      card,
      route: card.operations.map((operation) => operation.operationType.name),
      duration: formatDuration(card.totalDurationMinutes),
    })),
  );

  protected readonly loadError = computed(() => {
    const error = this.cards.error();
    return error ? describeApiError(error) : null;
  });

  protected async remove(card: ProcessCardDto): Promise<void> {
    if (!confirm(`Видалити технологічну карту деталі «${card.part.designation}»?`)) {
      return;
    }
    this.busyId.set(card.id);
    this.actionError.set(null);
    try {
      await this.#api.deleteProcessCard(card.id);
    } catch (error) {
      this.actionError.set(describeApiError(error));
    } finally {
      this.busyId.set(null);
      this.cards.reload();
    }
  }
}
```

## `web/src/app/catalog/ui/shell/shell.css`

```css
:host {
  display: grid;
  grid-template-rows: auto 1fr;
  min-height: 100dvh;
}

.topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1.5rem;
  padding: 0.75rem 1.25rem;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.brand {
  display: grid;
  color: inherit;
  line-height: 1.2;
  text-decoration: none;
}

.brand .eyebrow {
  margin: 0;
  font-size: 0.72rem;
}

nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

nav a {
  padding: 0.4rem 0.8rem;
  border-radius: 8px;
  color: var(--muted);
  font-weight: 600;
  text-decoration: none;
}

nav a.active {
  background: var(--surface-2);
  color: var(--text);
}

.database {
  margin-left: auto;
}

.database::before {
  content: '';
  display: inline-block;
  width: 0.5rem;
  height: 0.5rem;
  margin-right: 0.4rem;
  border-radius: 50%;
  background: currentColor;
  vertical-align: 0.05rem;
}

main {
  width: min(100%, 76rem);
  margin: 0 auto;
  padding: 1.5rem 1.25rem 2.5rem;
}

@media (max-width: 720px) {
  .database {
    margin-left: 0;
  }
}
```

## `web/src/app/catalog/ui/shell/shell.html`

```html
<header class="topbar">
  <a class="brand" routerLink="/">
    <span class="eyebrow">Лабораторна робота №5</span>
    <strong>Технологічні карти</strong>
  </a>

  <nav aria-label="Розділи">
    <a
      routerLink="/"
      routerLinkActive="active"
      [routerLinkActiveOptions]="{ exact: true }"
      ariaCurrentWhenActive="page"
      >Головна</a
    >
    <a routerLink="/process-cards" routerLinkActive="active" ariaCurrentWhenActive="page"
      >Технологічні карти</a
    >
    <a routerLink="/parts" routerLinkActive="active" ariaCurrentWhenActive="page">Деталі</a>
    <a routerLink="/operation-types" routerLinkActive="active" ariaCurrentWhenActive="page"
      >Види обробки</a
    >
    <a routerLink="/docs" routerLinkActive="active" ariaCurrentWhenActive="page">API</a>
  </nav>

  <span
    class="badge database"
    role="status"
    [attr.data-tone]="database() === 'up' ? 'ok' : database() === 'down' ? 'bad' : null"
    title="Стан підключення API до MongoDB (GET /api/health)"
  >
    @switch (database()) {
      @case ('up') {
        MongoDB підключено
      }
      @case ('down') {
        MongoDB недоступна
      }
      @default {
        Перевірка з’єднання…
      }
    }
  </span>
</header>

<main>
  <router-outlet />
</main>
```

## `web/src/app/catalog/ui/shell/shell.ts`

```typescript
import { httpResource } from '@angular/common/http';
import { Component, computed, DestroyRef, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { API } from '../../data-access/catalog-api';
import type { HealthResponse } from '../../data-access/contract';

const HEALTH_CHECK_INTERVAL_MS = 15_000;

@Component({
  selector: 'app-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
})
export class Shell {
  protected readonly health = httpResource<HealthResponse>(() => API.health);
  protected readonly database = computed(() => {
    if (this.health.hasValue()) {
      return this.health.value().database === 'up' ? 'up' : 'down';
    }
    return this.health.isLoading() ? 'checking' : 'down';
  });

  constructor() {
    const timer = setInterval(() => this.health.reload(), HEALTH_CHECK_INTERVAL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}
```

## `web/src/index.html`

```html
<!doctype html>
<html lang="uk">
  <head>
    <meta charset="utf-8" />
    <title>Технологічні карти · Лабораторна робота №5</title>
    <base href="/" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta
      name="description"
      content="Технологічні карти деталей: види обробки та тривалість операцій, REST API на FastAPI з MongoDB"
    />
    <meta name="color-scheme" content="light dark" />
    <link rel="icon" type="image/x-icon" href="favicon.ico" />
  </head>
  <body>
    <app-root></app-root>
  </body>
</html>
```

## `web/src/main.ts`

```typescript
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
```

## `web/src/styles.css`

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
  --own: #e3e8ff;
  --system: #fff4d6;
  --system-text: #6b4e00;
  --danger: #c62828;
  --success: #2e7d32;
  --warning: #9a5b00;
  --radius: 14px;
  --shadow: 0 1px 2px rgb(0 0 0 / 6%), 0 8px 24px rgb(0 0 0 / 6%);
  --mono: ui-monospace, 'Cascadia Code', 'JetBrains Mono', Menlo, monospace;

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
    --own: #26305c;
    --system: #3a3016;
    --system-text: #f3d68a;
    --danger: #ff6b6b;
    --success: #66bb6a;
    --warning: #ffb74d;
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
  background: var(--bg);
  color: var(--text);
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}

button,
input,
textarea,
select {
  font: inherit;
  color: inherit;
}

button,
a.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0.6rem 1.1rem;
  background: var(--accent);
  color: var(--accent-contrast);
  border: 0;
  border-radius: 10px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button.secondary,
a.button.secondary {
  background: var(--surface-2);
  color: var(--text);
}

button.ghost,
a.button.ghost {
  background: transparent;
  color: var(--muted);
  border: 1px solid var(--border);
}

button.small,
a.button.small {
  padding: 0.35rem 0.8rem;
}

button.icon {
  padding: 0.35rem 0.6rem;
}

button.danger:not(:disabled) {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 45%, transparent);
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

a {
  color: var(--accent);
}

.error {
  margin: 0;
  color: var(--danger);
  font-size: 0.9rem;
}

.notice {
  margin: 0;
  padding: 0.6rem 0.85rem;
  background: var(--system);
  color: var(--system-text);
  border-radius: 10px;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.page {
  display: grid;
  gap: 1.25rem;
}

.panel {
  display: grid;
  gap: 0.9rem;
  min-width: 0;
  padding: 1.25rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.panel-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem 1rem;
}

.panel-header h1,
.panel-header h2 {
  margin: 0;
  font-size: 1.15rem;
}

.eyebrow {
  margin: 0 0 0.25rem;
  color: var(--accent);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.meta,
.hint {
  margin: 0.25rem 0 0;
  color: var(--muted);
  font-size: 0.85rem;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.table-wrap {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th,
td {
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}

th {
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}

td.num,
th.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

td.actions {
  text-align: right;
  white-space: nowrap;
}

td.actions > * + * {
  margin-left: 0.35rem;
}

tr[aria-busy='true'] {
  opacity: 0.6;
}

.empty {
  color: var(--muted);
  text-align: center;
}

.code {
  font-family: var(--mono);
  font-size: 0.85rem;
  white-space: nowrap;
}

.muted {
  color: var(--muted);
}

.badge {
  display: inline-block;
  padding: 0.1rem 0.55rem;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--muted);
  font-size: 0.8rem;
  white-space: nowrap;
}

.badge[data-tone='ok'] {
  color: var(--success);
}

.badge[data-tone='bad'] {
  color: var(--danger);
}

.form {
  display: grid;
  gap: 1rem;
  max-width: 40rem;
}

.field {
  display: grid;
  gap: 0.35rem;
}

.field label {
  font-weight: 600;
}

input,
select,
textarea {
  width: 100%;
  padding: 0.6rem 0.8rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 10px;
}

textarea {
  min-height: 6rem;
  resize: vertical;
}

[aria-invalid='true'] {
  border-color: var(--danger);
}

.form-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}
```

## `web/src/swagger-ui.d.ts`

```typescript
declare module 'swagger-ui-dist/swagger-ui-es-bundle.js' {
  interface SwaggerUiOptions {
    readonly domNode: HTMLElement;
    readonly url: string;
    readonly [option: string]: unknown;
  }

  const SwaggerUI: (options: SwaggerUiOptions) => unknown;
  export default SwaggerUI;
}
```

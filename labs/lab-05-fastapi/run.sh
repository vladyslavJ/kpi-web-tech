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

#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  echo "Run this script with bash: ./run.sh <dev|prod>" >&2
  exit 1
fi

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ROOT
readonly BOT_DIR="$ROOT/bot"
readonly VENV="$BOT_DIR/.venv"
readonly PYTHON="$VENV/bin/python"
readonly PORT="${PORT:-8000}"
readonly MIN_PYTHON_MINOR=12
readonly STOP_TIMEOUT_SECONDS=10

if [[ -t 1 ]]; then
  readonly COLOR=1
else
  readonly COLOR=0
fi

SERVICE_PIDS=()

usage() {
  cat <<EOF
Usage: ./run.sh <dev|prod>

  dev   development mode: the bot polls Telegram and restarts on code changes, status page at http://localhost:${PORT}
  prod  lint and type check, then the bot runs with production settings, status page at http://localhost:${PORT}
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
}

check_settings() {
  if [[ ! -f "$BOT_DIR/.env" && -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
    fail "bot/.env not found: copy bot/.env.example to bot/.env and fill in TELEGRAM_BOT_TOKEN and GROQ_API_KEY"
  fi
}

port_open() {
  (exec 3<>"/dev/tcp/localhost/$1") 2>/dev/null
}

ensure_port_free() {
  if port_open "$1"; then
    fail "Port $1 is already in use: stop the process that is using it or set PORT"
  fi
}

install_dependencies() {
  local stamp="$VENV/.requirements.stamp"
  if [[ ! -x "$PYTHON" ]]; then
    info "bot: creating a virtual environment"
    python3 -m venv "$VENV"
  fi
  if [[ ! -f "$stamp" || "$BOT_DIR/requirements.txt" -nt "$stamp" || "$BOT_DIR/requirements-dev.txt" -nt "$stamp" ]]; then
    info "bot: installing dependencies"
    "$PYTHON" -m pip install --quiet --disable-pip-version-check -r "$BOT_DIR/requirements-dev.txt"
    touch "$stamp"
  fi
}

check_code() {
  info "bot: linting"
  (cd "$BOT_DIR" && "$VENV/bin/ruff" check --quiet . && "$VENV/bin/ruff" format --check --quiet .)
  info "bot: type checking"
  (cd "$BOT_DIR" && "$VENV/bin/mypy")
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
    "$app" "$label" "$BOT_DIR" "$@" </dev/null &
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
  trap '' INT TERM
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
  check_settings
  ensure_port_free "$PORT"

  install_dependencies
  if [[ "$mode" == prod ]]; then
    check_code
  fi

  trap stop_services EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  export -f prefix_lines
  export PORT PYTHONPATH="$BOT_DIR/src" PYTHONUNBUFFERED=1

  if [[ "$mode" == dev ]]; then
    info "starting in development mode"
    export APP_ENV=development LOG_FORMAT=text
    start_service bot '35' "$VENV/bin/watchfiles" --filter python --sigint-timeout 5 \
      "$(printf '%q' "$PYTHON") -m bot run" src
  else
    info "starting in production mode"
    export APP_ENV=production LOG_FORMAT=json
    start_service bot '35' "$PYTHON" -m bot run
  fi

  if wait_until_ready "$PORT"; then
    info "$(paint '1;32' "Application is ready to use: http://localhost:${PORT}") (Ctrl+C to stop)"
  fi

  local status=0
  wait -n || status=$?
  info "a service exited with code $status, stopping the rest"
  return "$status"
}

main "$@"

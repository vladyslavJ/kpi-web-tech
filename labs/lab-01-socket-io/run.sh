#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  echo "Запусти скрипт через bash: ./run.sh <dev|prod>" >&2
  exit 1
fi

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ROOT
readonly APPS=(api web)
readonly API_PORT="${PORT:-3000}"
readonly WEB_PORT=4200
readonly STOP_TIMEOUT_SECONDS=10

if [[ -t 1 ]]; then
  readonly COLOR=1
else
  readonly COLOR=0
fi

SERVICE_PIDS=()

usage() {
  cat <<EOF
Використання: ./run.sh <dev|prod>

  dev   режим розробки: http://localhost:${WEB_PORT}, перезапуск і перезбірка при змінах
  prod  перевірка типів і прод-збірка, потім сервер роздає клієнт: http://localhost:${API_PORT}
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
    fail "Потрібен bash 4.3 або новіший, зараз ${BASH_VERSION}"
  fi
  command -v setsid >/dev/null 2>&1 || fail "Не знайдено setsid (пакет util-linux)"
  command -v node >/dev/null 2>&1 || fail "Не знайдено Node.js, потрібна версія 24+"
  command -v npm >/dev/null 2>&1 || fail "Не знайдено npm"
  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  (( node_major >= 24 )) || fail "Потрібен Node.js 24+, зараз $(node --version)"
}

ensure_port_free() {
  if (exec 3<>"/dev/tcp/localhost/$1") 2>/dev/null; then
    fail "Порт $1 уже зайнятий: зупини процес, який його використовує"
  fi
}

install_dependencies() {
  local app dir
  for app in "${APPS[@]}"; do
    dir="$ROOT/$app"
    if [[ ! -d "$dir/node_modules" || "$dir/package-lock.json" -nt "$dir/node_modules/.package-lock.json" ]]; then
      info "$app: встановлюю залежності"
      (cd "$dir" && npm ci --no-audit --no-fund)
    fi
  done
}

build_apps() {
  local app
  for app in "${APPS[@]}"; do
    info "$app: збірка"
    (cd "$ROOT/$app" && npm run build --no-progress)
  done
}

prefix_lines() {
  trap '' INT TERM
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    printf '%s %s\n' "$1" "$line"
  done
}

start_service() {
  local app="$1" script="$2" color="$3" label
  label="$(paint "$color" "[$app]")"
  setsid bash -c 'set -o pipefail; cd "$1" && npm run "$2" 2>&1 | prefix_lines "$3"' \
    "$app" "$ROOT/$app" "$script" "$label" </dev/null &
  SERVICE_PIDS+=("$!")
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
  info "зупиняю сервіси"
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
  info "зупинено"
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

  trap stop_services EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  export -f prefix_lines

  if [[ "$mode" == dev ]]; then
    start_service api dev '35'
    start_service web dev '32'
    info "режим dev: відкрий http://localhost:${WEB_PORT}, Ctrl+C зупиняє все"
  else
    export STATIC_DIR="$ROOT/web/dist/web/browser"
    start_service api start '35'
    info "режим prod: відкрий http://localhost:${API_PORT}, Ctrl+C зупиняє все"
  fi

  local status=0
  wait -n || status=$?
  info "один із сервісів завершився з кодом $status, зупиняю решту"
  return "$status"
}

main "$@"

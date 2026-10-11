## `run.sh`

```bash
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
```

## `contracts/chat.contract.ts`

```typescript
export interface RoomDto {
  readonly id: string;
  readonly name: string;
}

export interface ParticipantDto {
  readonly id: string;
  readonly nickname: string;
  readonly joinedAt: string;
}

interface MessageBaseDto {
  readonly id: string;
  readonly sentAt: string;
}

export interface UserMessageDto extends MessageBaseDto {
  readonly type: 'user';
  readonly text: string;
  readonly author: Pick<ParticipantDto, 'id' | 'nickname'>;
}

export interface SystemMessageDto extends MessageBaseDto {
  readonly type: 'system';
  readonly text: string;
}

export type PresenceEvent = 'joined' | 'left';

export interface PresenceMessageDto extends MessageBaseDto {
  readonly type: 'presence';
  readonly event: PresenceEvent;
  readonly participant: Pick<ParticipantDto, 'id' | 'nickname'>;
}

export type MessageDto = UserMessageDto | SystemMessageDto | PresenceMessageDto;

export interface ChatSnapshotDto {
  readonly self: ParticipantDto;
  readonly room: RoomDto;
  readonly participants: readonly ParticipantDto[];
  readonly history: readonly MessageDto[];
}

export type ErrorCode = 'VALIDATION_ERROR' | 'RATE_LIMITED' | 'NOT_JOINED' | 'INTERNAL_ERROR';

export interface ErrorDto {
  readonly code: ErrorCode;
  readonly message: string;
}

export type Ack<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: ErrorDto };

export interface HandshakeAuth {
  readonly nickname: string;
  readonly room: string;
}

export interface SendMessagePayload {
  readonly text: string;
}

export interface ServerToClientEvents {
  'chat:snapshot': (snapshot: ChatSnapshotDto) => void;
  'message:new': (message: MessageDto) => void;
  'participant:joined': (participant: ParticipantDto) => void;
  'participant:left': (participant: ParticipantDto) => void;
}

export interface ClientToServerEvents {
  'message:send': (
    payload: SendMessagePayload,
    ack: (response: Ack<{ readonly id: string }>) => void,
  ) => void;
}
```

## `api/.env.example`

```dotenv
PORT=3000
CORS_ORIGINS=http://localhost:4200
HISTORY_LIMIT=50

AUTO_MESSAGE_INTERVAL_MS=21000
AUTO_MESSAGE_TEXT="Автоматичне повідомлення від ст. Жукова Владислава Віталійовича гр. ІС-33 Варіант 11"

RATE_LIMIT_BURST=5
RATE_LIMIT_REFILL_PER_SECOND=1

LOG_LEVEL=debug
```

## `api/package.json`

```json
{
  "name": "lab-01-socket-io-api",
  "version": "1.0.0",
  "private": true,
  "description": "Real-time chat server: Socket.IO, Node.js 24, TypeScript 7",
  "type": "module",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "dev": "NODE_ENV=development node --watch src/main.ts",
    "build": "tsc --noEmit",
    "start": "NODE_ENV=production node src/main.ts",
    "test": "node --test --test-reporter=spec \"../tmp/tests/api/**/*.test.ts\""
  },
  "dependencies": {
    "pino": "^10.3.1",
    "socket.io": "^4.8.4",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@types/node": "^24.19.0",
    "pino-pretty": "^13.1.3",
    "socket.io-client": "^4.8.4",
    "typescript": "^7.0.2"
  }
}
```

## `api/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "esnext",
    "lib": ["esnext"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "types": ["node"],

    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,

    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,

    "skipLibCheck": true
  },
  "include": ["src"]
}
```

## `api/src/app.ts`

```typescript
import { AutoMessageScheduler } from './application/auto-message.scheduler.ts';
import { BroadcastAutoMessage } from './application/broadcast-auto-message.use-case.ts';
import { JoinChat } from './application/join-chat.use-case.ts';
import { LeaveChat } from './application/leave-chat.use-case.ts';
import type { Clock, IdGenerator, Logger, Scheduler } from './application/ports.ts';
import { SendMessage } from './application/send-message.use-case.ts';
import type { AppConfig } from './config.ts';
import { createHttpServer, listen } from './infrastructure/http/http-server.ts';
import { createPinoLogger } from './infrastructure/logging/pino.logger.ts';
import { InMemoryMessageRepository } from './infrastructure/persistence/in-memory-message.repository.ts';
import { InMemoryParticipantRepository } from './infrastructure/persistence/in-memory-participant.repository.ts';
import { TokenBucketRateLimiter } from './infrastructure/rate-limit/token-bucket.rate-limiter.ts';
import { ChatGateway } from './infrastructure/realtime/chat.gateway.ts';
import { SocketIoChatNotifier } from './infrastructure/realtime/socket-io.notifier.ts';
import { createSocketServer } from './infrastructure/realtime/socket-server.ts';
import { intervalScheduler } from './infrastructure/scheduling/interval.scheduler.ts';
import { cryptoIdGenerator } from './infrastructure/system/crypto.id-generator.ts';
import { systemClock } from './infrastructure/system/system.clock.ts';

export interface Infrastructure {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly scheduler: Scheduler;
  readonly logger: Logger;
}

export interface App {
  start(): Promise<{ readonly port: number }>;
  stop(): Promise<void>;
}

export function createApp(config: AppConfig, overrides: Partial<Infrastructure> = {}): App {
  const clock = overrides.clock ?? systemClock;
  const ids = overrides.ids ?? cryptoIdGenerator;
  const scheduler = overrides.scheduler ?? intervalScheduler;
  const logger =
    overrides.logger ?? createPinoLogger({ level: config.logLevel, pretty: config.logFormat === 'pretty' });

  const httpServer = createHttpServer({ staticDir: config.staticDir });
  const io = createSocketServer(httpServer, config);

  const participants = new InMemoryParticipantRepository();
  const messages = new InMemoryMessageRepository({ capacity: config.historyLimit });
  const notifier = new SocketIoChatNotifier({ io });

  const autoMessages = new AutoMessageScheduler({
    scheduler,
    logger,
    intervalMs: config.autoMessage.intervalMs,
    broadcast: new BroadcastAutoMessage({ notifier, ids, clock, text: config.autoMessage.text }),
  });

  new ChatGateway({
    io,
    logger,
    rateLimiter: new TokenBucketRateLimiter({ ...config.rateLimit, clock }),
    joinChat: new JoinChat({
      participants,
      messages,
      notifier,
      ids,
      clock,
      historyLimit: config.historyLimit,
    }),
    leaveChat: new LeaveChat({ participants, messages, notifier, ids, clock }),
    sendMessage: new SendMessage({ participants, messages, notifier, ids, clock }),
  }).register();

  return {
    async start() {
      const port = await listen(httpServer, config.port);
      autoMessages.start();
      return { port };
    },
    async stop() {
      autoMessages.stop();
      await new Promise<void>((resolve) => {
        void io.close(() => resolve());
      });
    },
  };
}
```

## `api/src/application/auto-message.scheduler.ts`

```typescript
import type { BroadcastAutoMessage } from './broadcast-auto-message.use-case.ts';
import type { Logger, Scheduler } from './ports.ts';

export class AutoMessageScheduler {
  readonly #scheduler: Scheduler;
  readonly #broadcast: BroadcastAutoMessage;
  readonly #intervalMs: number;
  readonly #logger: Logger;
  #cancel: (() => void) | null = null;

  constructor(deps: {
    scheduler: Scheduler;
    broadcast: BroadcastAutoMessage;
    intervalMs: number;
    logger: Logger;
  }) {
    this.#scheduler = deps.scheduler;
    this.#broadcast = deps.broadcast;
    this.#intervalMs = deps.intervalMs;
    this.#logger = deps.logger;
  }

  start(): void {
    if (this.#cancel) {
      return;
    }
    this.#cancel = this.#scheduler.every(this.#intervalMs, () => this.#tick());
  }

  stop(): void {
    this.#cancel?.();
    this.#cancel = null;
  }

  #tick(): void {
    try {
      this.#broadcast.execute();
    } catch (error) {
      this.#logger.error('Auto message tick failed', { error });
    }
  }
}
```

## `api/src/application/broadcast-auto-message.use-case.ts`

```typescript
import { createSystemMessage, type SystemMessage } from '../domain/message.ts';
import type { ChatNotifier, Clock, IdGenerator } from './ports.ts';

export class BroadcastAutoMessage {
  readonly #notifier: ChatNotifier;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;
  readonly #text: string;

  constructor(deps: { notifier: ChatNotifier; ids: IdGenerator; clock: Clock; text: string }) {
    this.#notifier = deps.notifier;
    this.#ids = deps.ids;
    this.#clock = deps.clock;
    this.#text = deps.text;
  }

  execute(): SystemMessage {
    const message = createSystemMessage({
      id: this.#ids.next(),
      text: this.#text,
      sentAt: this.#clock.now(),
    });
    this.#notifier.announcementMade(message);
    return message;
  }
}
```

## `api/src/application/join-chat.use-case.ts`

```typescript
import { createPresenceMessage, type UserMessage } from '../domain/message.ts';
import { createParticipant, type Participant } from '../domain/participant.ts';
import { createRoom, type Room } from '../domain/room.ts';
import type { ChatNotifier, Clock, IdGenerator, MessageRepository, ParticipantRepository } from './ports.ts';

export interface ChatSnapshot {
  readonly self: Participant;
  readonly room: Room;
  readonly participants: readonly Participant[];
  readonly history: readonly UserMessage[];
}

export class JoinChat {
  readonly #participants: ParticipantRepository;
  readonly #messages: MessageRepository;
  readonly #notifier: ChatNotifier;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;
  readonly #historyLimit: number;

  constructor(deps: {
    participants: ParticipantRepository;
    messages: MessageRepository;
    notifier: ChatNotifier;
    ids: IdGenerator;
    clock: Clock;
    historyLimit: number;
  }) {
    this.#participants = deps.participants;
    this.#messages = deps.messages;
    this.#notifier = deps.notifier;
    this.#ids = deps.ids;
    this.#clock = deps.clock;
    this.#historyLimit = deps.historyLimit;
  }

  async execute(input: { nickname: string; roomName: string }): Promise<ChatSnapshot> {
    const requested = createRoom(input.roomName);
    const [occupant] = await this.#participants.listInRoom(requested.id);
    const room = occupant?.room ?? requested;

    const self = createParticipant({
      id: this.#ids.next(),
      nickname: input.nickname,
      room,
      joinedAt: this.#clock.now(),
    });
    await this.#participants.add(self);
    this.#notifier.participantJoined(self);
    this.#notifier.messagePosted(
      createPresenceMessage({ id: this.#ids.next(), event: 'joined', participant: self, sentAt: this.#clock.now() }),
    );

    const [participants, history] = await Promise.all([
      this.#participants.listInRoom(room.id),
      this.#messages.recent(room.id, this.#historyLimit),
    ]);
    return { self, room, participants, history };
  }
}
```

## `api/src/application/leave-chat.use-case.ts`

```typescript
import { createPresenceMessage } from '../domain/message.ts';
import type { ParticipantId } from '../domain/participant.ts';
import type { ChatNotifier, Clock, IdGenerator, MessageRepository, ParticipantRepository } from './ports.ts';

export class LeaveChat {
  readonly #participants: ParticipantRepository;
  readonly #messages: MessageRepository;
  readonly #notifier: ChatNotifier;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;

  constructor(deps: {
    participants: ParticipantRepository;
    messages: MessageRepository;
    notifier: ChatNotifier;
    ids: IdGenerator;
    clock: Clock;
  }) {
    this.#participants = deps.participants;
    this.#messages = deps.messages;
    this.#notifier = deps.notifier;
    this.#ids = deps.ids;
    this.#clock = deps.clock;
  }

  async execute(input: { participantId: ParticipantId }): Promise<void> {
    const participant = await this.#participants.remove(input.participantId);
    if (!participant) {
      return;
    }
    this.#notifier.participantLeft(participant);
    this.#notifier.messagePosted(
      createPresenceMessage({ id: this.#ids.next(), event: 'left', participant, sentAt: this.#clock.now() }),
    );

    const remaining = await this.#participants.listInRoom(participant.room.id);
    if (remaining.length === 0) {
      await this.#messages.clearRoom(participant.room.id);
    }
  }
}
```

## `api/src/application/ports.ts`

```typescript
import type { RoomMessage, SystemMessage, UserMessage } from '../domain/message.ts';
import type { Participant, ParticipantId } from '../domain/participant.ts';
import type { RoomId } from '../domain/room.ts';

export interface ParticipantRepository {
  add(participant: Participant): Promise<void>;
  remove(id: ParticipantId): Promise<Participant | undefined>;
  get(id: ParticipantId): Promise<Participant | undefined>;
  listInRoom(roomId: RoomId): Promise<readonly Participant[]>;
}

export interface MessageRepository {
  append(message: UserMessage): Promise<void>;
  recent(roomId: RoomId, limit: number): Promise<readonly UserMessage[]>;
  clearRoom(roomId: RoomId): Promise<void>;
}

export interface ChatNotifier {
  messagePosted(message: RoomMessage): void;
  announcementMade(message: SystemMessage): void;
  participantJoined(participant: Participant): void;
  participantLeft(participant: Participant): void;
}

export interface Scheduler {
  every(intervalMs: number, task: () => void): () => void;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(bindings: LogContext): Logger;
}
```

## `api/src/application/result.ts`

```typescript
export type AppErrorCode = 'NOT_JOINED';

export interface AppError {
  readonly code: AppErrorCode;
  readonly message: string;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: AppError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err(code: AppErrorCode, message: string): Result<never> {
  return { ok: false, error: { code, message } };
}
```

## `api/src/application/send-message.use-case.ts`

```typescript
import { createUserMessage, type MessageId } from '../domain/message.ts';
import type { ParticipantId } from '../domain/participant.ts';
import type { ChatNotifier, Clock, IdGenerator, MessageRepository, ParticipantRepository } from './ports.ts';
import { err, ok, type Result } from './result.ts';

export class SendMessage {
  readonly #participants: ParticipantRepository;
  readonly #messages: MessageRepository;
  readonly #notifier: ChatNotifier;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;

  constructor(deps: {
    participants: ParticipantRepository;
    messages: MessageRepository;
    notifier: ChatNotifier;
    ids: IdGenerator;
    clock: Clock;
  }) {
    this.#participants = deps.participants;
    this.#messages = deps.messages;
    this.#notifier = deps.notifier;
    this.#ids = deps.ids;
    this.#clock = deps.clock;
  }

  async execute(input: { authorId: ParticipantId; text: string }): Promise<Result<{ id: MessageId }>> {
    const author = await this.#participants.get(input.authorId);
    if (!author) {
      return err('NOT_JOINED', 'Join the chat before sending messages');
    }

    const message = createUserMessage({
      id: this.#ids.next(),
      author,
      text: input.text,
      sentAt: this.#clock.now(),
    });
    await this.#messages.append(message);
    this.#notifier.messagePosted(message);
    return ok({ id: message.id });
  }
}
```

## `api/src/config.ts`

```typescript
import { z } from 'zod';
import type { LogLevel } from './application/ports.ts';
import { MESSAGE_MAX_LENGTH } from './domain/message.ts';

const DEFAULT_AUTO_MESSAGE_TEXT =
  'Автоматичне повідомлення від ст. Жукова Владислава Віталійовича гр. ІС-33 Варіант 11';

export type Environment = 'development' | 'production' | 'test';

export type LogFormat = 'pretty' | 'json';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
  CORS_ORIGINS: z.string().default('http://localhost:4200'),
  HISTORY_LIMIT: z.coerce.number().int().min(0).max(500).default(50),
  AUTO_MESSAGE_INTERVAL_MS: z.coerce.number().int().min(100).default(21_000),
  AUTO_MESSAGE_TEXT: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH).default(DEFAULT_AUTO_MESSAGE_TEXT),
  RATE_LIMIT_BURST: z.coerce.number().int().min(1).default(5),
  RATE_LIMIT_REFILL_PER_SECOND: z.coerce.number().positive().default(1),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  STATIC_DIR: z.string().trim().min(1).optional(),
});

export interface AppConfig {
  readonly environment: Environment;
  readonly port: number;
  readonly corsOrigins: readonly string[];
  readonly historyLimit: number;
  readonly maxPayloadBytes: number;
  readonly autoMessage: { readonly text: string; readonly intervalMs: number };
  readonly rateLimit: { readonly capacity: number; readonly refillPerSecond: number };
  readonly logLevel: LogLevel;
  readonly logFormat: LogFormat;
  readonly staticDir: string | undefined;
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export function loadConfig(env: Readonly<Record<string, string | undefined>>): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const vars = parsed.data;
  return {
    environment: vars.NODE_ENV,
    port: vars.PORT,
    corsOrigins: vars.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    historyLimit: vars.HISTORY_LIMIT,
    maxPayloadBytes: 16 * 1024,
    autoMessage: { text: vars.AUTO_MESSAGE_TEXT, intervalMs: vars.AUTO_MESSAGE_INTERVAL_MS },
    rateLimit: { capacity: vars.RATE_LIMIT_BURST, refillPerSecond: vars.RATE_LIMIT_REFILL_PER_SECOND },
    logLevel: vars.LOG_LEVEL ?? (vars.NODE_ENV === 'production' ? 'info' : 'debug'),
    logFormat: vars.NODE_ENV === 'development' ? 'pretty' : 'json',
    staticDir: vars.STATIC_DIR,
  };
}
```

## `api/src/domain/display-name.ts`

```typescript
export const DISPLAY_NAME_PATTERN = /^[\p{L}\p{N} _.-]{2,32}$/u;

export function normalizeDisplayName(raw: string): string {
  return raw.trim().replace(/\s+/gu, ' ');
}

export function isValidDisplayName(normalized: string): boolean {
  return DISPLAY_NAME_PATTERN.test(normalized);
}
```

## `api/src/domain/domain-error.ts`

```typescript
export class DomainError extends Error {
  override readonly name = 'DomainError';
}
```

## `api/src/domain/message.ts`

```typescript
import { DomainError } from './domain-error.ts';
import type { Participant } from './participant.ts';
import type { RoomId } from './room.ts';

export type MessageId = string & { readonly __brand: 'MessageId' };

export const MESSAGE_MAX_LENGTH = 1000;

interface MessageBase {
  readonly id: MessageId;
  readonly sentAt: Date;
}

export interface UserMessage extends MessageBase {
  readonly type: 'user';
  readonly roomId: RoomId;
  readonly author: Pick<Participant, 'id' | 'nickname'>;
  readonly text: string;
}

export interface SystemMessage extends MessageBase {
  readonly type: 'system';
  readonly text: string;
}

export type PresenceEvent = 'joined' | 'left';

export interface PresenceMessage extends MessageBase {
  readonly type: 'presence';
  readonly roomId: RoomId;
  readonly event: PresenceEvent;
  readonly participant: Pick<Participant, 'id' | 'nickname'>;
}

export type RoomMessage = UserMessage | PresenceMessage;

export type Message = UserMessage | SystemMessage | PresenceMessage;

export function normalizeMessageText(raw: string): string {
  return raw.replace(/[\p{Cc}--[\n\t]]/gv, '').trim();
}

export function createUserMessage(props: {
  id: string;
  author: Participant;
  text: string;
  sentAt: Date;
}): UserMessage {
  const message: UserMessage = {
    type: 'user',
    id: props.id as MessageId,
    roomId: props.author.room.id,
    author: snapshotOf(props.author),
    text: validText(props.text),
    sentAt: props.sentAt,
  };
  return Object.freeze(message);
}

export function createSystemMessage(props: { id: string; text: string; sentAt: Date }): SystemMessage {
  const message: SystemMessage = {
    type: 'system',
    id: props.id as MessageId,
    text: validText(props.text),
    sentAt: props.sentAt,
  };
  return Object.freeze(message);
}

export function createPresenceMessage(props: {
  id: string;
  event: PresenceEvent;
  participant: Participant;
  sentAt: Date;
}): PresenceMessage {
  const message: PresenceMessage = {
    type: 'presence',
    id: props.id as MessageId,
    roomId: props.participant.room.id,
    event: props.event,
    participant: snapshotOf(props.participant),
    sentAt: props.sentAt,
  };
  return Object.freeze(message);
}

function snapshotOf(participant: Participant): Pick<Participant, 'id' | 'nickname'> {
  return Object.freeze({ id: participant.id, nickname: participant.nickname });
}

function validText(raw: string): string {
  const text = normalizeMessageText(raw);
  if (text.length === 0 || text.length > MESSAGE_MAX_LENGTH) {
    throw new DomainError(`Message text must be 1–${MESSAGE_MAX_LENGTH} characters long`);
  }
  return text;
}
```

## `api/src/domain/participant.ts`

```typescript
import { isValidDisplayName, normalizeDisplayName } from './display-name.ts';
import { DomainError } from './domain-error.ts';
import type { Room } from './room.ts';

export type ParticipantId = string & { readonly __brand: 'ParticipantId' };

export interface Participant {
  readonly id: ParticipantId;
  readonly nickname: string;
  readonly room: Room;
  readonly joinedAt: Date;
}

export function createParticipant(props: {
  id: string;
  nickname: string;
  room: Room;
  joinedAt: Date;
}): Participant {
  const nickname = normalizeDisplayName(props.nickname);
  if (!isValidDisplayName(nickname)) {
    throw new DomainError(`Invalid nickname: ${JSON.stringify(props.nickname)}`);
  }
  const participant: Participant = {
    id: props.id as ParticipantId,
    nickname,
    room: props.room,
    joinedAt: props.joinedAt,
  };
  return Object.freeze(participant);
}
```

## `api/src/domain/room.ts`

```typescript
import { isValidDisplayName, normalizeDisplayName } from './display-name.ts';
import { DomainError } from './domain-error.ts';

export type RoomId = string & { readonly __brand: 'RoomId' };

export interface Room {
  readonly id: RoomId;
  readonly name: string;
}

export function createRoom(rawName: string): Room {
  const name = normalizeDisplayName(rawName);
  if (!isValidDisplayName(name)) {
    throw new DomainError(`Invalid room name: ${JSON.stringify(rawName)}`);
  }
  const room: Room = { id: roomIdOf(name), name };
  return Object.freeze(room);
}

export function roomIdOf(rawName: string): RoomId {
  return normalizeDisplayName(rawName).toLowerCase() as RoomId;
}
```

## `api/src/infrastructure/http/http-server.ts`

```typescript
import { createServer, type Server, type ServerResponse } from 'node:http';
import { createStaticHandler } from './static-files.ts';

export interface HttpServerOptions {
  readonly staticDir?: string | undefined;
}

export function createHttpServer(options: HttpServerOptions = {}): Server {
  const serveStatic = options.staticDir ? createStaticHandler(options.staticDir) : null;

  return createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, { status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
      return;
    }
    if (serveStatic && (request.method === 'GET' || request.method === 'HEAD')) {
      void serveStatic(request, response);
      return;
    }
    sendJson(response, 404, { error: 'Not Found' });
  });
}

export function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      const address = server.address();
      resolve(typeof address === 'object' && address !== null ? address.port : port);
    });
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}
```

## `api/src/infrastructure/http/static-files.ts`

```typescript
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const HASHED_ASSET = /-[A-Z0-9]{8,}\.[a-z0-9]+$/;

export type StaticHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

export function createStaticHandler(directory: string): StaticHandler {
  const root = path.resolve(directory);
  const indexFile = path.join(root, 'index.html');
  if (!existsSync(indexFile)) {
    throw new Error(`Static directory has no index.html: ${root}`);
  }

  return async (request, response) => {
    const requested = resolveInside(root, request.url ?? '/');
    if (requested === null) {
      respond(response, 404, 'Not Found');
      return;
    }

    const file = await findFile(requested);
    if (file) {
      sendFile(request, response, file);
    } else if (path.extname(requested) === '') {
      sendFile(request, response, indexFile);
    } else {
      respond(response, 404, 'Not Found');
    }
  };
}

function resolveInside(root: string, url: string): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  } catch {
    return null;
  }
  const resolved = path.resolve(root, `.${pathname}`);
  return resolved === root || resolved.startsWith(root + path.sep) ? resolved : null;
}

async function findFile(candidate: string): Promise<string | null> {
  try {
    const stats = await stat(candidate);
    if (stats.isFile()) {
      return candidate;
    }
    if (stats.isDirectory()) {
      return findFile(path.join(candidate, 'index.html'));
    }
  } catch {
    return null;
  }
  return null;
}

function sendFile(request: IncomingMessage, response: ServerResponse, file: string): void {
  const extension = path.extname(file);
  response.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
    'Cache-Control': HASHED_ASSET.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(file)
    .on('error', () => response.destroy())
    .pipe(response);
}

function respond(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(text);
}
```

## `api/src/infrastructure/logging/pino.logger.ts`

```typescript
import pino from 'pino';
import type { LogContext, Logger, LogLevel } from '../../application/ports.ts';

export interface PinoLoggerOptions {
  readonly level: LogLevel;
  readonly pretty: boolean;
}

export function createPinoLogger(options: PinoLoggerOptions): Logger {
  return new PinoLogger(
    pino({
      level: options.level,
      serializers: { error: pino.stdSerializers.err },
      transport: options.pretty ? { target: 'pino-pretty' } : undefined,
    }),
  );
}

class PinoLogger implements Logger {
  readonly #pino: pino.Logger;

  constructor(instance: pino.Logger) {
    this.#pino = instance;
  }

  debug(message: string, context: LogContext = {}): void {
    this.#pino.debug(context, message);
  }

  info(message: string, context: LogContext = {}): void {
    this.#pino.info(context, message);
  }

  warn(message: string, context: LogContext = {}): void {
    this.#pino.warn(context, message);
  }

  error(message: string, context: LogContext = {}): void {
    this.#pino.error(context, message);
  }

  child(bindings: LogContext): Logger {
    return new PinoLogger(this.#pino.child(bindings));
  }
}
```

## `api/src/infrastructure/persistence/in-memory-message.repository.ts`

```typescript
import type { MessageRepository } from '../../application/ports.ts';
import type { UserMessage } from '../../domain/message.ts';
import type { RoomId } from '../../domain/room.ts';

export class InMemoryMessageRepository implements MessageRepository {
  readonly #capacity: number;
  readonly #rooms = new Map<RoomId, UserMessage[]>();

  constructor(options: { capacity: number }) {
    this.#capacity = options.capacity;
  }

  async append(message: UserMessage): Promise<void> {
    const messages = this.#rooms.get(message.roomId) ?? [];
    messages.push(message);
    if (messages.length > this.#capacity) {
      messages.shift();
    }
    this.#rooms.set(message.roomId, messages);
  }

  async recent(roomId: RoomId, limit: number): Promise<readonly UserMessage[]> {
    const messages = this.#rooms.get(roomId) ?? [];
    return limit > 0 ? messages.slice(-limit) : [];
  }

  async clearRoom(roomId: RoomId): Promise<void> {
    this.#rooms.delete(roomId);
  }
}
```

## `api/src/infrastructure/persistence/in-memory-participant.repository.ts`

```typescript
import type { ParticipantRepository } from '../../application/ports.ts';
import type { Participant, ParticipantId } from '../../domain/participant.ts';
import type { RoomId } from '../../domain/room.ts';

export class InMemoryParticipantRepository implements ParticipantRepository {
  readonly #participants = new Map<ParticipantId, Participant>();

  async add(participant: Participant): Promise<void> {
    this.#participants.set(participant.id, participant);
  }

  async remove(id: ParticipantId): Promise<Participant | undefined> {
    const participant = this.#participants.get(id);
    this.#participants.delete(id);
    return participant;
  }

  async get(id: ParticipantId): Promise<Participant | undefined> {
    return this.#participants.get(id);
  }

  async listInRoom(roomId: RoomId): Promise<readonly Participant[]> {
    return [...this.#participants.values()].filter((participant) => participant.room.id === roomId);
  }
}
```

## `api/src/infrastructure/rate-limit/rate-limiter.ts`

```typescript
export interface RateLimiter {
  tryConsume(key: string): Promise<boolean>;
  release(key: string): Promise<void>;
}
```

## `api/src/infrastructure/rate-limit/token-bucket.rate-limiter.ts`

```typescript
import type { Clock } from '../../application/ports.ts';
import type { RateLimiter } from './rate-limiter.ts';

interface Bucket {
  readonly tokens: number;
  readonly updatedAt: number;
}

export class TokenBucketRateLimiter implements RateLimiter {
  readonly #capacity: number;
  readonly #refillPerSecond: number;
  readonly #clock: Clock;
  readonly #buckets = new Map<string, Bucket>();

  constructor(options: { capacity: number; refillPerSecond: number; clock: Clock }) {
    this.#capacity = options.capacity;
    this.#refillPerSecond = options.refillPerSecond;
    this.#clock = options.clock;
  }

  async tryConsume(key: string): Promise<boolean> {
    const now = this.#clock.now().getTime();
    const bucket = this.#buckets.get(key) ?? { tokens: this.#capacity, updatedAt: now };
    const refilled = (now - bucket.updatedAt) / 1000 * this.#refillPerSecond;
    const tokens = Math.min(this.#capacity, bucket.tokens + refilled);

    if (tokens < 1) {
      this.#buckets.set(key, { tokens, updatedAt: now });
      return false;
    }
    this.#buckets.set(key, { tokens: tokens - 1, updatedAt: now });
    return true;
  }

  async release(key: string): Promise<void> {
    this.#buckets.delete(key);
  }
}
```

## `api/src/infrastructure/realtime/chat.gateway.ts`

```typescript
import type { JoinChat } from '../../application/join-chat.use-case.ts';
import type { LeaveChat } from '../../application/leave-chat.use-case.ts';
import type { Logger } from '../../application/ports.ts';
import { err } from '../../application/result.ts';
import type { SendMessage } from '../../application/send-message.use-case.ts';
import { roomIdOf } from '../../domain/room.ts';
import type { RateLimiter } from '../rate-limit/rate-limiter.ts';
import { withPipeline, type HandlerContext } from './handler-pipeline.ts';
import { createHandshakeMiddleware } from './handshake.middleware.ts';
import { toSnapshotDto } from './mappers.ts';
import { sendMessagePayloadSchema } from './schemas.ts';
import { roomChannel } from './socket-io.notifier.ts';
import type { ChatServer, ChatSocket } from './socket-server.ts';

export class ChatGateway {
  readonly #io: ChatServer;
  readonly #joinChat: JoinChat;
  readonly #leaveChat: LeaveChat;
  readonly #sendMessage: SendMessage;
  readonly #rateLimiter: RateLimiter;
  readonly #logger: Logger;

  constructor(deps: {
    io: ChatServer;
    joinChat: JoinChat;
    leaveChat: LeaveChat;
    sendMessage: SendMessage;
    rateLimiter: RateLimiter;
    logger: Logger;
  }) {
    this.#io = deps.io;
    this.#joinChat = deps.joinChat;
    this.#leaveChat = deps.leaveChat;
    this.#sendMessage = deps.sendMessage;
    this.#rateLimiter = deps.rateLimiter;
    this.#logger = deps.logger;
  }

  register(): void {
    this.#io.use(createHandshakeMiddleware(this.#logger));
    this.#io.on('connection', (socket) => this.#onConnection(socket));
  }

  #onConnection(socket: ChatSocket): void {
    const logger = this.#logger.child({ socketId: socket.id });
    const ctx: HandlerContext = { socketId: socket.id, logger, rateLimiter: this.#rateLimiter };

    socket.on(
      'message:send',
      withPipeline<'message:send'>(ctx, {
        schema: sendMessagePayloadSchema,
        handle: async ({ text }) => {
          const authorId = socket.data.participantId;
          if (!authorId) {
            return err('NOT_JOINED', 'Join the chat before sending messages');
          }
          return this.#sendMessage.execute({ authorId, text });
        },
      }),
    );
    socket.on('disconnect', (reason) => void this.#onDisconnect(socket, logger, reason));

    void this.#join(socket, logger);
  }

  async #join(socket: ChatSocket, logger: Logger): Promise<void> {
    const { nickname, roomName } = socket.data;
    if (nickname === undefined || roomName === undefined) {
      logger.error('Connection without a validated handshake');
      socket.disconnect(true);
      return;
    }

    try {
      await socket.join(roomChannel(roomIdOf(roomName)));
      const snapshot = await this.#joinChat.execute({ nickname, roomName });
      socket.data.participantId = snapshot.self.id;

      if (socket.disconnected) {
        await this.#leave(socket);
        return;
      }
      socket.emit('chat:snapshot', toSnapshotDto(snapshot));
      logger.info('Participant joined', {
        participantId: snapshot.self.id,
        nickname: snapshot.self.nickname,
        room: snapshot.room.name,
      });
    } catch (error) {
      logger.error('Join failed', { error });
      socket.disconnect(true);
    }
  }

  async #onDisconnect(socket: ChatSocket, logger: Logger, reason: string): Promise<void> {
    try {
      await this.#rateLimiter.release(socket.id);
      await this.#leave(socket);
      logger.info('Socket disconnected', { reason });
    } catch (error) {
      logger.error('Leave failed', { error });
    }
  }

  async #leave(socket: ChatSocket): Promise<void> {
    const participantId = socket.data.participantId;
    if (!participantId) {
      return;
    }
    socket.data.participantId = undefined;
    await this.#leaveChat.execute({ participantId });
  }
}
```

## `api/src/infrastructure/realtime/contract.ts`

```typescript
export type * from '../../../../contracts/chat.contract.ts';
```

## `api/src/infrastructure/realtime/handler-pipeline.ts`

```typescript
import { z } from 'zod';
import type { Logger } from '../../application/ports.ts';
import type { Result } from '../../application/result.ts';
import type { RateLimiter } from '../rate-limit/rate-limiter.ts';
import type { Ack, ClientToServerEvents } from './contract.ts';
import { failure, toAck } from './mappers.ts';

type ClientEvent = keyof ClientToServerEvents;

type EventPayload<E extends ClientEvent> = Parameters<ClientToServerEvents[E]>[0];

type EventAckData<E extends ClientEvent> =
  Parameters<ClientToServerEvents[E]>[1] extends (response: Ack<infer T>) => void ? T : never;

export interface HandlerContext {
  readonly socketId: string;
  readonly logger: Logger;
  readonly rateLimiter: RateLimiter;
}

export interface HandlerSpec<E extends ClientEvent> {
  readonly schema: z.ZodType<EventPayload<E>>;
  readonly handle: (payload: EventPayload<E>) => Promise<Result<EventAckData<E>>>;
}

export function withPipeline<E extends ClientEvent>(ctx: HandlerContext, spec: HandlerSpec<E>) {
  return async (raw: unknown, ack: unknown): Promise<void> => {
    if (typeof ack !== 'function') {
      ctx.logger.warn('Event without acknowledgement callback ignored');
      return;
    }
    const reply = ack as (response: Ack<EventAckData<E>>) => void;

    if (!(await ctx.rateLimiter.tryConsume(ctx.socketId))) {
      reply(failure('RATE_LIMITED', 'Too many messages, slow down'));
      return;
    }

    const parsed = spec.schema.safeParse(raw);
    if (!parsed.success) {
      reply(failure('VALIDATION_ERROR', z.prettifyError(parsed.error)));
      return;
    }

    try {
      reply(toAck(await spec.handle(parsed.data)));
    } catch (error) {
      ctx.logger.error('Unhandled error in event handler', { error });
      reply(failure('INTERNAL_ERROR', 'Internal server error'));
    }
  };
}
```

## `api/src/infrastructure/realtime/handshake.middleware.ts`

```typescript
import { z } from 'zod';
import type { Logger } from '../../application/ports.ts';
import type { ErrorCode, ErrorDto } from './contract.ts';
import { toErrorDto } from './mappers.ts';
import { handshakeAuthSchema } from './schemas.ts';
import type { ChatServer } from './socket-server.ts';

type Middleware = Parameters<ChatServer['use']>[0];

export function createHandshakeMiddleware(logger: Logger): Middleware {
  return (socket, next) => {
    const parsed = handshakeAuthSchema.safeParse(socket.handshake.auth);
    if (!parsed.success) {
      logger.debug('Handshake rejected', { socketId: socket.id });
      next(rejection('VALIDATION_ERROR', z.prettifyError(parsed.error)));
      return;
    }
    socket.data.nickname = parsed.data.nickname;
    socket.data.roomName = parsed.data.room;
    next();
  };
}

function rejection(code: ErrorCode, message: string): Error & { data: ErrorDto } {
  return Object.assign(new Error(code), { data: toErrorDto(code, message) });
}
```

## `api/src/infrastructure/realtime/mappers.ts`

```typescript
import type { ChatSnapshot } from '../../application/join-chat.use-case.ts';
import type { Result } from '../../application/result.ts';
import type { Message } from '../../domain/message.ts';
import type { Participant } from '../../domain/participant.ts';
import type { Room } from '../../domain/room.ts';
import type { Ack, ChatSnapshotDto, ErrorCode, ErrorDto, MessageDto, ParticipantDto, RoomDto } from './contract.ts';

export function toParticipantDto(participant: Participant): ParticipantDto {
  return {
    id: participant.id,
    nickname: participant.nickname,
    joinedAt: participant.joinedAt.toISOString(),
  };
}

export function toRoomDto(room: Room): RoomDto {
  return { id: room.id, name: room.name };
}

export function toMessageDto(message: Message): MessageDto {
  const base = { id: message.id, sentAt: message.sentAt.toISOString() };
  switch (message.type) {
    case 'user':
      return {
        ...base,
        type: 'user',
        text: message.text,
        author: { id: message.author.id, nickname: message.author.nickname },
      };
    case 'system':
      return { ...base, type: 'system', text: message.text };
    case 'presence':
      return {
        ...base,
        type: 'presence',
        event: message.event,
        participant: { id: message.participant.id, nickname: message.participant.nickname },
      };
  }
}

export function toSnapshotDto(snapshot: ChatSnapshot): ChatSnapshotDto {
  return {
    self: toParticipantDto(snapshot.self),
    room: toRoomDto(snapshot.room),
    participants: snapshot.participants.map(toParticipantDto),
    history: snapshot.history.map(toMessageDto),
  };
}

export function toErrorDto(code: ErrorCode, message: string): ErrorDto {
  return { code, message };
}

export function toAck<T>(result: Result<T>): Ack<T> {
  return result.ok ? { ok: true, data: result.value } : { ok: false, error: result.error };
}

export function failure(code: ErrorCode, message: string): Ack<never> {
  return { ok: false, error: toErrorDto(code, message) };
}
```

## `api/src/infrastructure/realtime/schemas.ts`

```typescript
import { z } from 'zod';
import { MESSAGE_MAX_LENGTH, normalizeMessageText } from '../../domain/message.ts';
import { DISPLAY_NAME_PATTERN, normalizeDisplayName } from '../../domain/display-name.ts';
import type { HandshakeAuth, SendMessagePayload } from './contract.ts';

const displayName = (label: string) =>
  z
    .string()
    .transform(normalizeDisplayName)
    .pipe(z.string().regex(DISPLAY_NAME_PATTERN, `${label} must be 2–32 characters: letters, digits, spaces, _ . -`));

export const handshakeAuthSchema = z.object({
  nickname: displayName('Nickname'),
  room: displayName('Room name'),
}) satisfies z.ZodType<HandshakeAuth>;

export const sendMessagePayloadSchema = z.object({
  text: z
    .string()
    .transform(normalizeMessageText)
    .pipe(
      z
        .string()
        .min(1, 'Message is empty')
        .max(MESSAGE_MAX_LENGTH, `Message is longer than ${MESSAGE_MAX_LENGTH} characters`),
    ),
}) satisfies z.ZodType<SendMessagePayload>;
```

## `api/src/infrastructure/realtime/socket-io.notifier.ts`

```typescript
import type { ChatNotifier } from '../../application/ports.ts';
import type { RoomMessage, SystemMessage } from '../../domain/message.ts';
import type { Participant } from '../../domain/participant.ts';
import type { RoomId } from '../../domain/room.ts';
import { toMessageDto, toParticipantDto } from './mappers.ts';
import type { ChatServer } from './socket-server.ts';

export function roomChannel(roomId: RoomId): string {
  return `room:${roomId}`;
}

export class SocketIoChatNotifier implements ChatNotifier {
  readonly #io: ChatServer;

  constructor(deps: { io: ChatServer }) {
    this.#io = deps.io;
  }

  messagePosted(message: RoomMessage): void {
    this.#io.to(roomChannel(message.roomId)).emit('message:new', toMessageDto(message));
  }

  announcementMade(message: SystemMessage): void {
    this.#io.emit('message:new', toMessageDto(message));
  }

  participantJoined(participant: Participant): void {
    this.#io.to(roomChannel(participant.room.id)).emit('participant:joined', toParticipantDto(participant));
  }

  participantLeft(participant: Participant): void {
    this.#io.to(roomChannel(participant.room.id)).emit('participant:left', toParticipantDto(participant));
  }
}
```

## `api/src/infrastructure/realtime/socket-server.ts`

```typescript
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { ParticipantId } from '../../domain/participant.ts';
import type { ClientToServerEvents, ServerToClientEvents } from './contract.ts';

export interface SocketData {
  nickname?: string;
  roomName?: string;
  participantId?: ParticipantId;
}

export type InterServerEvents = Record<never, never>;

export type ChatServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
export type ChatSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export interface SocketServerOptions {
  readonly corsOrigins: readonly string[];
  readonly maxPayloadBytes: number;
}

export function createSocketServer(httpServer: HttpServer, options: SocketServerOptions): ChatServer {
  return new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
    cors: { origin: [...options.corsOrigins] },
    serveClient: false,
    maxHttpBufferSize: options.maxPayloadBytes,
  });
}
```

## `api/src/infrastructure/scheduling/interval.scheduler.ts`

```typescript
import type { Scheduler } from '../../application/ports.ts';

export const intervalScheduler: Scheduler = {
  every(intervalMs, task) {
    const timer = setInterval(task, intervalMs);
    return () => clearInterval(timer);
  },
};
```

## `api/src/infrastructure/system/crypto.id-generator.ts`

```typescript
import { randomUUID } from 'node:crypto';
import type { IdGenerator } from '../../application/ports.ts';

export const cryptoIdGenerator: IdGenerator = {
  next: () => randomUUID(),
};
```

## `api/src/infrastructure/system/system.clock.ts`

```typescript
import type { Clock } from '../../application/ports.ts';

export const systemClock: Clock = {
  now: () => new Date(),
};
```

## `api/src/main.ts`

```typescript
import { createApp } from './app.ts';
import { ConfigError, loadConfig, type AppConfig } from './config.ts';
import { createPinoLogger } from './infrastructure/logging/pino.logger.ts';

const SHUTDOWN_TIMEOUT_MS = 10_000;

loadDotEnvOutsideProduction();
const config = loadConfigOrExit();
const logger = createPinoLogger({ level: config.logLevel, pretty: config.logFormat === 'pretty' });
const app = createApp(config, { logger });

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { error: reason });
  process.exit(1);
});

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info('Shutting down', { signal });

  setTimeout(() => {
    logger.error('Shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  await app.stop();
  logger.info('Server stopped');
}
process.on('SIGINT', (signal) => void shutdown(signal));
process.on('SIGTERM', (signal) => void shutdown(signal));

const { port } = await app.start();
logger.info('Chat server listening', {
  environment: config.environment,
  port,
  corsOrigins: config.corsOrigins,
  staticDir: config.staticDir ?? null,
  autoMessageIntervalMs: config.autoMessage.intervalMs,
});

function loadDotEnvOutsideProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    return;
  }
  try {
    process.loadEnvFile('.env');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

function loadConfigOrExit(): AppConfig {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
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
              "src/styles.css"
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
    "socket.io-client": "^4.8.4",
    "tslib": "^2.3.0"
  },
  "devDependencies": {
    "@angular/build": "^22.2.0",
    "@angular/cli": "^22.2.0",
    "@angular/compiler-cli": "^22.2.0",
    "jsdom": "^30.0.0",
    "prettier": "^3.8.1",
    "typescript": "~6.0.2",
    "vitest": "^5.0.0"
  }
}
```

## `web/proxy.conf.json`

```json
{
  "/socket.io": {
    "target": "http://localhost:3000",
    "ws": true
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
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { ChatGateway } from './chat/data-access/chat-gateway';
import { SocketIoChatGateway } from './chat/data-access/socket-io-chat-gateway';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ChatGateway, useClass: SocketIoChatGateway },
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
@if (store.joined()) {
  <app-chat-room />
} @else {
  <app-join-form />
}
```

## `web/src/app/app.ts`

```typescript
import { Component, inject } from '@angular/core';
import { ChatStore } from './chat/data-access/chat-store';
import { ChatRoom } from './chat/ui/chat-room/chat-room';
import { JoinForm } from './chat/ui/join-form/join-form';

@Component({
  selector: 'app-root',
  imports: [ChatRoom, JoinForm],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly store = inject(ChatStore);
}
```

## `web/src/app/chat/data-access/chat-errors.ts`

```typescript
import type { SendErrorCode } from './chat-gateway';
import { MESSAGE_MAX_LENGTH, NAME_HINT } from './chat-rules';
import type { ErrorCode } from './contract';

const SEND_ERRORS: Record<SendErrorCode, string> = {
  VALIDATION_ERROR: `Повідомлення порожнє або довше за ${MESSAGE_MAX_LENGTH} символів.`,
  RATE_LIMITED: 'Забагато повідомлень поспіль — зачекайте кілька секунд.',
  NOT_JOINED: 'Ви ще не в чаті — зачекайте на підключення.',
  INTERNAL_ERROR: 'Помилка сервера. Спробуйте ще раз.',
  TIMEOUT: 'Сервер не відповів вчасно. Перевірте з’єднання.',
  OFFLINE: 'Немає з’єднання з сервером.',
};

export function describeSendError(code: SendErrorCode): string {
  return SEND_ERRORS[code];
}

export function describeJoinError(code: ErrorCode): string {
  return code === 'VALIDATION_ERROR'
    ? `Сервер не прийняв нікнейм або назву кімнати. ${NAME_HINT}.`
    : 'Сервер відхилив підключення. Спробуйте ще раз.';
}
```

## `web/src/app/chat/data-access/chat-gateway.ts`

```typescript
import type { ChatSnapshotDto, ErrorCode, MessageDto, ParticipantDto } from './contract';

export type ConnectionStatus =
  'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export type ChatEvent =
  | { readonly type: 'status'; readonly status: ConnectionStatus }
  | { readonly type: 'rejected'; readonly code: ErrorCode }
  | { readonly type: 'snapshot'; readonly snapshot: ChatSnapshotDto }
  | { readonly type: 'message'; readonly message: MessageDto }
  | { readonly type: 'participant-joined'; readonly participant: ParticipantDto }
  | { readonly type: 'participant-left'; readonly participant: ParticipantDto };

export type ChatEventListener = (event: ChatEvent) => void;

export interface JoinRequest {
  readonly nickname: string;
  readonly room: string;
}

export type SendErrorCode = ErrorCode | 'TIMEOUT' | 'OFFLINE';

export type SendResult =
  { readonly ok: true; readonly id: string } | { readonly ok: false; readonly code: SendErrorCode };

export abstract class ChatGateway {
  abstract connect(request: JoinRequest, listener: ChatEventListener): void;
  abstract disconnect(): void;
  abstract send(text: string): Promise<SendResult>;
}
```

## `web/src/app/chat/data-access/chat-rules.ts`

```typescript
export const NAME_PATTERN = /^[\p{L}\p{N} _.-]{2,32}$/u;
export const NAME_MAX_LENGTH = 32;
export const NAME_HINT = '2–32 символи: літери, цифри, пробіл, _ . -';

export const DEFAULT_ROOM = 'Загальна';

export const MESSAGE_MAX_LENGTH = 1000;

export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/gu, ' ');
}

export function isValidName(raw: string): boolean {
  return NAME_PATTERN.test(normalizeName(raw));
}
```

## `web/src/app/chat/data-access/chat-store.ts`

```typescript
import { computed, inject, Injectable, signal } from '@angular/core';
import { describeJoinError, describeSendError } from './chat-errors';
import {
  ChatGateway,
  type ChatEvent,
  type ConnectionStatus,
  type JoinRequest,
} from './chat-gateway';
import type { MessageDto, ParticipantDto, RoomDto } from './contract';

const MAX_MESSAGES = 300;

@Injectable({ providedIn: 'root' })
export class ChatStore {
  readonly #gateway = inject(ChatGateway);

  readonly #status = signal<ConnectionStatus>('idle');
  readonly #self = signal<ParticipantDto | null>(null);
  readonly #room = signal<RoomDto | null>(null);
  readonly #participants = signal<readonly ParticipantDto[]>([]);
  readonly #messages = signal<readonly MessageDto[]>([]);
  readonly #ownIds = signal<ReadonlySet<string>>(new Set());
  readonly #joinError = signal<string | null>(null);
  readonly #sendError = signal<string | null>(null);
  readonly #sending = signal(false);

  readonly status = this.#status.asReadonly();
  readonly self = this.#self.asReadonly();
  readonly room = this.#room.asReadonly();
  readonly messages = this.#messages.asReadonly();
  readonly ownIds = this.#ownIds.asReadonly();
  readonly joinError = this.#joinError.asReadonly();
  readonly sendError = this.#sendError.asReadonly();
  readonly sending = this.#sending.asReadonly();

  readonly joined = computed(() => this.#self() !== null);
  readonly connecting = computed(() => {
    const status = this.#status();
    return !this.joined() && (status === 'connecting' || status === 'reconnecting');
  });
  readonly canSend = computed(() => this.joined() && this.#status() === 'connected');
  readonly participants = computed(() =>
    [...this.#participants()].sort((a, b) => a.nickname.localeCompare(b.nickname, 'uk')),
  );

  join(request: JoinRequest): void {
    this.#reset();
    this.#gateway.connect(request, (event) => this.#apply(event));
  }

  leave(): void {
    this.#gateway.disconnect();
    this.#reset();
  }

  async send(text: string): Promise<boolean> {
    this.#sendError.set(null);
    this.#sending.set(true);
    try {
      const result = await this.#gateway.send(text);
      if (!result.ok) {
        this.#sendError.set(describeSendError(result.code));
      }
      return result.ok;
    } finally {
      this.#sending.set(false);
    }
  }

  #apply(event: ChatEvent): void {
    switch (event.type) {
      case 'status':
        this.#status.set(event.status);
        break;
      case 'rejected':
        this.#status.set('disconnected');
        this.#joinError.set(describeJoinError(event.code));
        break;
      case 'snapshot': {
        const { self, participants, history } = event.snapshot;
        this.#self.set(self);
        this.#room.set(event.snapshot.room);
        this.#ownIds.update((ids) => new Set(ids).add(self.id));
        this.#participants.set(participants);
        this.#messages.update((current) => mergeMessages(current, history));
        this.#joinError.set(null);
        break;
      }
      case 'message':
        this.#messages.update((current) => mergeMessages(current, [event.message]));
        break;
      case 'participant-joined':
        this.#participants.update((list) => [
          ...list.filter((participant) => participant.id !== event.participant.id),
          event.participant,
        ]);
        break;
      case 'participant-left':
        this.#participants.update((list) =>
          list.filter((participant) => participant.id !== event.participant.id),
        );
        break;
      default:
        event satisfies never;
    }
  }

  #reset(): void {
    this.#status.set('idle');
    this.#self.set(null);
    this.#room.set(null);
    this.#participants.set([]);
    this.#messages.set([]);
    this.#ownIds.set(new Set());
    this.#joinError.set(null);
    this.#sendError.set(null);
    this.#sending.set(false);
  }
}

function mergeMessages(
  current: readonly MessageDto[],
  incoming: readonly MessageDto[],
): readonly MessageDto[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    byId.set(message.id, message);
  }
  return [...byId.values()]
    .sort((a, b) => (a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : 0))
    .slice(-MAX_MESSAGES);
}
```

## `web/src/app/chat/data-access/contract.ts`

```typescript
export type * from '../../../../../contracts/chat.contract';
```

## `web/src/app/chat/data-access/socket-io-chat-gateway.ts`

```typescript
import { Injectable, type OnDestroy } from '@angular/core';
import { io, type Socket } from 'socket.io-client';
import {
  ChatGateway,
  type ChatEventListener,
  type JoinRequest,
  type SendResult,
} from './chat-gateway';
import type {
  ClientToServerEvents,
  ErrorCode,
  ErrorDto,
  HandshakeAuth,
  ServerToClientEvents,
} from './contract';

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const ACK_TIMEOUT_MS = 5000;

@Injectable()
export class SocketIoChatGateway extends ChatGateway implements OnDestroy {
  #socket: ChatSocket | null = null;

  connect(request: JoinRequest, listener: ChatEventListener): void {
    this.disconnect();

    const auth: HandshakeAuth = { nickname: request.nickname, room: request.room };
    const socket: ChatSocket = io({ auth, autoConnect: false });

    socket.on('connect', () => listener({ type: 'status', status: 'connected' }));
    socket.on('disconnect', () => {
      listener({ type: 'status', status: socket.active ? 'reconnecting' : 'disconnected' });
    });
    socket.on('connect_error', (error) => {
      if (socket.active) {
        listener({ type: 'status', status: 'reconnecting' });
      } else {
        listener({ type: 'rejected', code: readErrorCode(error) });
      }
    });
    socket.on('chat:snapshot', (snapshot) => listener({ type: 'snapshot', snapshot }));
    socket.on('message:new', (message) => listener({ type: 'message', message }));
    socket.on('participant:joined', (participant) =>
      listener({ type: 'participant-joined', participant }),
    );
    socket.on('participant:left', (participant) =>
      listener({ type: 'participant-left', participant }),
    );

    this.#socket = socket;
    listener({ type: 'status', status: 'connecting' });
    socket.connect();
  }

  disconnect(): void {
    const socket = this.#socket;
    this.#socket = null;
    socket?.removeAllListeners();
    socket?.disconnect();
  }

  async send(text: string): Promise<SendResult> {
    const socket = this.#socket;
    if (!socket?.connected) {
      return { ok: false, code: 'OFFLINE' };
    }
    try {
      const ack = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck('message:send', { text });
      return ack.ok ? { ok: true, id: ack.data.id } : { ok: false, code: ack.error.code };
    } catch {
      return { ok: false, code: 'TIMEOUT' };
    }
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}

function readErrorCode(error: Error): ErrorCode {
  const data = (error as Error & { data?: Partial<ErrorDto> }).data;
  return data?.code ?? 'INTERNAL_ERROR';
}
```

## `web/src/app/chat/ui/chat-room/chat-room.css`

```css
:host {
  display: grid;
  height: 100dvh;
  grid-template:
    'top top' auto
    'banner banner' auto
    'messages people' 1fr
    'composer people' auto
    / 1fr 16rem;
}

.topbar {
  grid-area: top;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 1.25rem;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.title,
.me {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

h1 {
  margin: 0;
  font-size: 1.2rem;
}

.room-label {
  color: var(--muted);
  font-size: 0.85rem;
  font-weight: 500;
}

.status {
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--muted);
  font-size: 0.8rem;
}

.status[data-status='connected'] {
  color: var(--success);
}

.status[data-status='reconnecting'] {
  color: var(--warning);
}

.status[data-status='disconnected'] {
  color: var(--danger);
}

.nickname {
  color: var(--muted);
}

.banner {
  grid-area: banner;
  display: flex;
  align-items: center;
  gap: 1rem;
  margin: 0;
  padding: 0.6rem 1.25rem;
  background: var(--system);
  color: var(--system-text);
}

app-message-list {
  grid-area: messages;
  min-height: 0;
}

app-participant-list {
  grid-area: people;
  min-height: 0;
  background: var(--surface);
  border-left: 1px solid var(--border);
}

app-message-composer {
  grid-area: composer;
}

@media (max-width: 720px) {
  :host {
    grid-template:
      'top' auto
      'banner' auto
      'people' auto
      'messages' 1fr
      'composer' auto
      / 1fr;
  }

  app-participant-list {
    border-left: 0;
    border-bottom: 1px solid var(--border);
  }

  .nickname {
    display: none;
  }
}
```

## `web/src/app/chat/ui/chat-room/chat-room.html`

```html
<header class="topbar">
  <div class="title">
    <h1><span class="room-label">Кімната</span> {{ store.room()?.name }}</h1>
    <span class="status" role="status" [attr.data-status]="store.status()">{{
      statusLabel()
    }}</span>
  </div>
  <div class="me">
    <span class="nickname"
      >Ви: <strong>{{ store.self()?.nickname }}</strong></span
    >
    <button type="button" class="ghost" (click)="leave()">Вийти</button>
  </div>
</header>

@switch (store.status()) {
  @case ('reconnecting') {
    <p class="banner">
      З’єднання втрачено. Перепідключаємося — пропущені повідомлення підтягнуться з історії.
    </p>
  }
  @case ('disconnected') {
    <p class="banner">
      Сервер закрив з’єднання.
      <button type="button" class="secondary" (click)="leave()">Увійти знову</button>
    </p>
  }
}

<app-message-list [messages]="store.messages()" [ownIds]="store.ownIds()" />
<app-participant-list [participants]="store.participants()" [selfId]="store.self()?.id ?? null" />
<app-message-composer
  [(draft)]="draft"
  [connected]="store.canSend()"
  [sending]="store.sending()"
  [error]="store.sendError()"
  (send)="send()"
/>
```

## `web/src/app/chat/ui/chat-room/chat-room.ts`

```typescript
import { Component, computed, inject, signal } from '@angular/core';
import type { ConnectionStatus } from '../../data-access/chat-gateway';
import { ChatStore } from '../../data-access/chat-store';
import { MessageComposer } from '../message-composer/message-composer';
import { MessageList } from '../message-list/message-list';
import { ParticipantList } from '../participant-list/participant-list';

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  idle: 'Не підключено',
  connecting: 'Підключення…',
  connected: 'Онлайн',
  reconnecting: 'Перепідключення…',
  disconnected: 'Відключено',
};

@Component({
  selector: 'app-chat-room',
  imports: [MessageComposer, MessageList, ParticipantList],
  templateUrl: './chat-room.html',
  styleUrl: './chat-room.css',
})
export class ChatRoom {
  protected readonly store = inject(ChatStore);
  protected readonly draft = signal('');
  protected readonly statusLabel = computed(() => STATUS_LABELS[this.store.status()]);

  protected async send(): Promise<void> {
    const text = this.draft();
    const accepted = await this.store.send(text);
    if (accepted && this.draft() === text) {
      this.draft.set('');
    }
  }

  protected leave(): void {
    this.store.leave();
  }
}
```

## `web/src/app/chat/ui/join-form/join-form.css`

```css
:host {
  display: grid;
  place-items: center;
  min-height: 100dvh;
  padding: 1.5rem;
}

.card {
  width: min(100%, 27rem);
  padding: 2rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.eyebrow {
  margin: 0 0 0.5rem;
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font-size: 1.6rem;
}

.lead {
  margin: 0.5rem 0 1.5rem;
  color: var(--muted);
}

form {
  display: grid;
  gap: 0.5rem;
}

label {
  font-weight: 600;
}

label:not(:first-child) {
  margin-top: 0.5rem;
}

input {
  width: 100%;
  padding: 0.7rem 0.85rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 10px;
}

input[aria-invalid='true'] {
  border-color: var(--danger);
}

.hint {
  margin: 0;
  color: var(--muted);
  font-size: 0.85rem;
}

.actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.75rem;
}

.status {
  margin: 0;
  color: var(--muted);
  font-size: 0.9rem;
}
```

## `web/src/app/chat/ui/join-form/join-form.html`

```html
<section class="card" aria-labelledby="join-title">
  <p class="eyebrow">Лабораторна робота №1 · Socket.IO</p>
  <h1 id="join-title">Чат у реальному часі</h1>
  <p class="lead">
    Оберіть нікнейм і кімнату. Кожен, хто введе ту саму назву кімнати, потрапить до вас.
  </p>

  <form [formRoot]="form">
    <label for="nickname">Нікнейм</label>
    <input
      id="nickname"
      type="text"
      autocomplete="nickname"
      placeholder="Наприклад, Владислав"
      [formField]="form.nickname"
      [attr.aria-invalid]="nicknameError() !== null"
      autofocus
    />
    @if (nicknameError(); as error) {
      <p class="error" role="alert">{{ error }}</p>
    }

    <label for="room">Кімната</label>
    <input
      id="room"
      type="text"
      autocomplete="off"
      placeholder="Наприклад, ІС-33"
      [formField]="form.room"
      [attr.aria-invalid]="roomError() !== null"
    />
    @if (roomError(); as error) {
      <p class="error" role="alert">{{ error }}</p>
    }

    <p class="hint">Нікнейм і назва кімнати: {{ hint }}. Регістр у назві кімнати не важливий.</p>

    @if (store.joinError(); as error) {
      <p class="error" role="alert">{{ error }}</p>
    }

    <div class="actions">
      @if (store.connecting()) {
        <button type="button" class="secondary" (click)="cancel()">Скасувати</button>
        <p class="status" role="status">
          {{
            store.status() === 'reconnecting'
              ? 'Сервер недоступний, повторюємо спробу…'
              : 'Підключення…'
          }}
        </p>
      } @else {
        <button type="submit">Увійти в кімнату</button>
      }
    </div>
  </form>
</section>
```

## `web/src/app/chat/ui/join-form/join-form.ts`

```typescript
import { Component, computed, inject, signal } from '@angular/core';
import {
  form,
  FormField,
  FormRoot,
  maxLength,
  required,
  validate,
  type SchemaPath,
} from '@angular/forms/signals';
import {
  DEFAULT_ROOM,
  isValidName,
  NAME_HINT,
  NAME_MAX_LENGTH,
  normalizeName,
} from '../../data-access/chat-rules';
import { ChatStore } from '../../data-access/chat-store';

function nameRules(path: SchemaPath<string>, requiredMessage: string): void {
  required(path, { message: requiredMessage });
  maxLength(path, NAME_MAX_LENGTH, { message: NAME_HINT });
  validate(path, ({ value }) =>
    value() === '' || isValidName(value()) ? undefined : { kind: 'name', message: NAME_HINT },
  );
}

@Component({
  selector: 'app-join-form',
  imports: [FormField, FormRoot],
  templateUrl: './join-form.html',
  styleUrl: './join-form.css',
})
export class JoinForm {
  protected readonly store = inject(ChatStore);
  protected readonly hint = NAME_HINT;

  readonly #model = signal({ nickname: '', room: DEFAULT_ROOM });

  protected readonly form = form(
    this.#model,
    (path) => {
      nameRules(path.nickname, 'Введіть нікнейм');
      nameRules(path.room, 'Введіть назву кімнати');
    },
    {
      submission: {
        action: async (field) => {
          this.store.join({
            nickname: normalizeName(field.nickname().value()),
            room: normalizeName(field.room().value()),
          });
          return undefined;
        },
      },
    },
  );

  protected readonly nicknameError = computed(() => this.#firstError(this.form.nickname));
  protected readonly roomError = computed(() => this.#firstError(this.form.room));

  protected cancel(): void {
    this.store.leave();
  }

  #firstError(field: typeof this.form.nickname): string | null {
    const state = field();
    return state.touched() && state.invalid() ? (state.errors()[0]?.message ?? NAME_HINT) : null;
  }
}
```

## `web/src/app/chat/ui/message-composer/message-composer.css`

```css
:host {
  display: block;
  background: var(--surface);
  border-top: 1px solid var(--border);
}

form {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.4rem 0.75rem;
  padding: 0.75rem 1.25rem;
}

textarea {
  min-height: 2.8rem;
  max-height: 9rem;
  padding: 0.6rem 0.8rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  resize: vertical;
}

.meta {
  grid-column: 1 / -1;
  display: flex;
  gap: 1rem;
  min-height: 1.2em;
  color: var(--muted);
  font-size: 0.8rem;
}

.counter {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.counter.over {
  color: var(--danger);
}
```

## `web/src/app/chat/ui/message-composer/message-composer.html`

```html
<form (submit)="$event.preventDefault(); submit()">
  <label class="visually-hidden" for="message">Повідомлення</label>
  <textarea
    id="message"
    rows="2"
    placeholder="Повідомлення… Enter — надіслати, Shift+Enter — новий рядок"
    [value]="draft()"
    [attr.maxlength]="maxLength"
    (input)="onInput($event)"
    (keydown)="onKeydown($event)"
    aria-describedby="composer-meta"
  ></textarea>
  <button type="submit" [disabled]="!canSubmit()">
    {{ sending() ? 'Надсилання…' : 'Надіслати' }}
  </button>

  <div id="composer-meta" class="meta">
    @if (error(); as message) {
      <span class="error" role="alert">{{ message }}</span>
    } @else if (!connected()) {
      <span>Немає з’єднання — надіслати можна буде, щойно воно відновиться.</span>
    }
    <span class="counter" [class.over]="length() > maxLength"
      >{{ length() }} / {{ maxLength }}</span
    >
  </div>
</form>
```

## `web/src/app/chat/ui/message-composer/message-composer.ts`

```typescript
import { Component, computed, input, model, output } from '@angular/core';
import { MESSAGE_MAX_LENGTH } from '../../data-access/chat-rules';

@Component({
  selector: 'app-message-composer',
  templateUrl: './message-composer.html',
  styleUrl: './message-composer.css',
})
export class MessageComposer {
  readonly draft = model.required<string>();
  readonly connected = input(true);
  readonly sending = input(false);
  readonly error = input<string | null>(null);
  readonly send = output<void>();

  protected readonly maxLength = MESSAGE_MAX_LENGTH;
  protected readonly length = computed(() => this.draft().trim().length);
  protected readonly canSubmit = computed(
    () =>
      this.connected() && !this.sending() && this.length() > 0 && this.length() <= this.maxLength,
  );

  protected onInput(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.submit();
    }
  }

  protected submit(): void {
    if (this.canSubmit()) {
      this.send.emit();
    }
  }
}
```

## `web/src/app/chat/ui/message-list/message-list.css`

```css
:host {
  display: block;
  overflow: hidden;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  height: 100%;
  margin: 0;
  padding: 1rem 1.25rem;
  overflow-y: auto;
  list-style: none;
}

.bubble {
  align-self: flex-start;
  max-width: min(75%, 40rem);
  padding: 0.5rem 0.8rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px var(--radius) var(--radius) var(--radius);
}

.bubble.own {
  align-self: flex-end;
  background: var(--own);
  border-radius: var(--radius) 4px var(--radius) var(--radius);
}

.meta {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  color: var(--muted);
  font-size: 0.8rem;
}

.author {
  color: var(--text);
  font-weight: 600;
}

.text {
  margin: 0.2rem 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.system {
  align-self: center;
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  max-width: 90%;
  padding: 0.35rem 0.9rem;
  background: var(--system);
  color: var(--system-text);
  border-radius: 999px;
  font-size: 0.85rem;
  text-align: center;
}

.system time {
  opacity: 0.75;
}

.presence {
  align-self: center;
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  color: var(--muted);
  font-size: 0.8rem;
}

.presence::before {
  content: '→';
  color: var(--success);
}

.presence[data-event='left']::before {
  content: '←';
  color: var(--danger);
}

.empty {
  margin: auto;
  color: var(--muted);
}
```

## `web/src/app/chat/ui/message-list/message-list.html`

```html
<ol
  #scroller
  class="list"
  role="log"
  aria-live="polite"
  aria-label="Повідомлення чату"
  (scroll)="onScroll()"
>
  @for (message of messages(); track message.id) {
    @switch (message.type) {
      @case ('system') {
        <li class="system">
          <span>{{ message.text }}</span>
          <time [attr.datetime]="message.sentAt">{{ message.sentAt | date: 'HH:mm:ss' }}</time>
        </li>
      }
      @case ('presence') {
        <li class="presence" [attr.data-event]="message.event">
          <span>{{ presenceText(message) }}</span>
          <time [attr.datetime]="message.sentAt">{{ message.sentAt | date: 'HH:mm:ss' }}</time>
        </li>
      }
      @case ('user') {
        <li class="bubble" [class.own]="isOwn(message)">
          <div class="meta">
            <span class="author">{{ message.author.nickname }}</span>
            <time [attr.datetime]="message.sentAt">{{ message.sentAt | date: 'HH:mm:ss' }}</time>
          </div>
          <p class="text">{{ message.text }}</p>
        </li>
      }
    }
  } @empty {
    <li class="empty">Поки що тихо. Напишіть перше повідомлення!</li>
  }
</ol>
```

## `web/src/app/chat/ui/message-list/message-list.ts`

```typescript
import { DatePipe } from '@angular/common';
import { afterRenderEffect, Component, ElementRef, input, viewChild } from '@angular/core';
import type { MessageDto, PresenceMessageDto } from '../../data-access/contract';

@Component({
  selector: 'app-message-list',
  imports: [DatePipe],
  templateUrl: './message-list.html',
  styleUrl: './message-list.css',
})
export class MessageList {
  readonly messages = input.required<readonly MessageDto[]>();
  readonly ownIds = input.required<ReadonlySet<string>>();

  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  #stickToBottom = true;

  constructor() {
    afterRenderEffect(() => {
      this.messages();
      const element = this.scroller().nativeElement;
      if (this.#stickToBottom) {
        element.scrollTop = element.scrollHeight;
      }
    });
  }

  protected onScroll(): void {
    const element = this.scroller().nativeElement;
    this.#stickToBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
  }

  protected isOwn(message: MessageDto): boolean {
    return message.type === 'user' && this.ownIds().has(message.author.id);
  }

  protected presenceText(message: PresenceMessageDto): string {
    if (this.ownIds().has(message.participant.id)) {
      return message.event === 'joined' ? 'Ви увійшли до кімнати' : 'Ви вийшли з кімнати';
    }
    return message.event === 'joined'
      ? `${message.participant.nickname} приєднується до кімнати`
      : `${message.participant.nickname} виходить з кімнати`;
  }
}
```

## `web/src/app/chat/ui/participant-list/participant-list.css`

```css
:host {
  display: block;
  padding: 1rem;
  overflow-y: auto;
}

h2 {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.75rem;
  color: var(--muted);
  font-size: 0.85rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.count {
  padding: 0 0.5rem;
  background: var(--surface-2);
  color: var(--text);
  border-radius: 999px;
}

ul {
  display: grid;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

li {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
}

.avatar {
  display: grid;
  flex: none;
  place-items: center;
  width: 2rem;
  height: 2rem;
  background: hsl(var(--hue, 220) 55% 45%);
  color: #fff;
  border-radius: 50%;
  font-weight: 700;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.self .name {
  font-weight: 600;
}

.you {
  color: var(--muted);
  font-size: 0.85rem;
}

@media (max-width: 720px) {
  :host {
    padding: 0.6rem 1rem;
  }

  ul {
    grid-auto-columns: max-content;
    grid-auto-flow: column;
    overflow-x: auto;
  }
}
```

## `web/src/app/chat/ui/participant-list/participant-list.html`

```html
<h2 id="people-title">
  Онлайн <span class="count">{{ participants().length }}</span>
</h2>
<ul aria-labelledby="people-title">
  @for (participant of participants(); track participant.id) {
    <li [class.self]="participant.id === selfId()">
      <span class="avatar" aria-hidden="true" [style.--hue]="hue(participant.nickname)">
        {{ initial(participant.nickname) }}
      </span>
      <span class="name">{{ participant.nickname }}</span>
      @if (participant.id === selfId()) {
        <span class="you">(ви)</span>
      }
    </li>
  }
</ul>
```

## `web/src/app/chat/ui/participant-list/participant-list.ts`

```typescript
import { Component, input } from '@angular/core';
import type { ParticipantDto } from '../../data-access/contract';

@Component({
  selector: 'app-participant-list',
  templateUrl: './participant-list.html',
  styleUrl: './participant-list.css',
})
export class ParticipantList {
  readonly participants = input.required<readonly ParticipantDto[]>();
  readonly selfId = input<string | null>(null);

  protected initial(nickname: string): string {
    return nickname.trim().charAt(0).toUpperCase();
  }

  protected hue(nickname: string): number {
    let hash = 0;
    for (const char of nickname) {
      hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
    }
    return hash;
  }
}
```

## `web/src/index.html`

```html
<!doctype html>
<html lang="uk">
  <head>
    <meta charset="utf-8" />
    <title>Чат · Лабораторна робота №1</title>
    <base href="/" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Чат у реальному часі на Socket.IO та Angular" />
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
textarea {
  font: inherit;
  color: inherit;
}

button {
  padding: 0.6rem 1.1rem;
  background: var(--accent);
  color: var(--accent-contrast);
  border: 0;
  border-radius: 10px;
  font-weight: 600;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button.secondary {
  background: var(--surface-2);
  color: var(--text);
}

button.ghost {
  background: transparent;
  color: var(--muted);
  border: 1px solid var(--border);
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.error {
  margin: 0;
  color: var(--danger);
  font-size: 0.9rem;
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
```

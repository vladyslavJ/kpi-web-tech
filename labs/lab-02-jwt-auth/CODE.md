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
Usage: ./run.sh <dev|prod>

  dev   development mode at http://localhost:${WEB_PORT}, restarts and rebuilds on code changes
  prod  type check and production build, then the server serves the client at http://localhost:${API_PORT}
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
  command -v node >/dev/null 2>&1 || fail "Node.js not found, version 24+ is required"
  command -v npm >/dev/null 2>&1 || fail "npm not found"
  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  (( node_major >= 24 )) || fail "Node.js 24+ is required, found $(node --version)"
}

port_open() {
  (exec 3<>"/dev/tcp/localhost/$1") 2>/dev/null
}

ensure_port_free() {
  if port_open "$1"; then
    fail "Port $1 is already in use: stop the process that is using it"
  fi
}

install_dependencies() {
  local app dir
  for app in "${APPS[@]}"; do
    dir="$ROOT/$app"
    if [[ ! -d "$dir/node_modules" || "$dir/package-lock.json" -nt "$dir/node_modules/.package-lock.json" ]]; then
      info "$app: installing dependencies"
      (cd "$dir" && npm ci --no-audit --no-fund)
    fi
  done
}

build_apps() {
  local app
  for app in "${APPS[@]}"; do
    info "$app: building"
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

ensure_jwt_secret() {
  if [[ -n "${JWT_SECRET:-}" ]]; then
    return 0
  fi
  JWT_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(48).toString("base64url"))')"
  export JWT_SECRET
  info "JWT_SECRET is not set, using a random secret for this run (issued tokens stop working after a restart)"
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

  local app_port ports
  if [[ "$mode" == dev ]]; then
    info "starting in development mode"
    start_service api dev '35'
    start_service web dev '32'
    app_port="$WEB_PORT"
    ports=("$API_PORT" "$WEB_PORT")
  else
    info "starting in production mode"
    ensure_jwt_secret
    export STATIC_DIR="$ROOT/web/dist/web/browser"
    start_service api start '35'
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

## `contracts/auth.contract.ts`

```typescript
export type Role = 'user' | 'admin';

export interface UserDto {
  readonly id: string;
  readonly username: string;
  readonly role: Role;
  readonly createdAt: string;
}

export interface CredentialsRequest {
  readonly username: string;
  readonly password: string;
}

export interface ChangeRoleRequest {
  readonly role: Role;
}

export interface TokenClaimsDto {
  readonly sub: string;
  readonly username: string;
  readonly role: Role;
  readonly author: string;
  readonly group: string;
  readonly variant: number;
  readonly iss: string;
  readonly iat: number;
  readonly exp: number;
}

export interface AuthResponse {
  readonly token: string;
  readonly expiresAt: string;
  readonly user: UserDto;
}

export interface ProfileResponse {
  readonly user: UserDto;
  readonly claims: TokenClaimsDto;
}

export interface UsersResponse {
  readonly users: readonly UserDto[];
}

export interface UserResponse {
  readonly user: UserDto;
}

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'USERNAME_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'UNAUTHORIZED'
  | 'TOKEN_EXPIRED'
  | 'INVALID_TOKEN'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'LAST_ADMIN'
  | 'SELF_DELETE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export interface ErrorResponse {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
  };
}
```

## `api/.env.example`

```dotenv
PORT=3000
DATA_FILE=data/users.json

JWT_SECRET=replace-with-a-random-string-of-at-least-32-characters
JWT_ISSUER=lab-02-jwt-auth
JWT_TTL_SECONDS=71

TOKEN_AUTHOR="Жуков В.В."
TOKEN_GROUP="ІС-33"
TOKEN_VARIANT=11

AUTH_RATE_LIMIT_MAX=10
AUTH_RATE_LIMIT_WINDOW_MS=60000

LOG_LEVEL=debug
```

## `api/package.json`

```json
{
  "name": "lab-02-jwt-auth-api",
  "version": "1.0.0",
  "private": true,
  "description": "Registration, JWT authentication and role-based access",
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
    "express": "^5.3.0",
    "express-rate-limit": "^8.7.1",
    "jose": "^6.2.12",
    "pino": "^10.4.0",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@types/express": "^5.0.6",
    "@types/node": "^24.19.2",
    "pino-pretty": "^13.2.0",
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
import { createServer } from 'node:http';
import { AuthenticateToken } from './application/authenticate-token.use-case.ts';
import { ChangeUserRole } from './application/change-user-role.use-case.ts';
import { DeleteUser } from './application/delete-user.use-case.ts';
import { ListUsers } from './application/list-users.use-case.ts';
import { LoginUser } from './application/login-user.use-case.ts';
import type {
  Clock,
  IdGenerator,
  Logger,
  PasswordHasher,
  TokenService,
  UserRepository,
} from './application/ports.ts';
import { RegisterUser } from './application/register-user.use-case.ts';
import type { AppConfig } from './config.ts';
import { close, createHttpApp, listen } from './infrastructure/http/server.ts';
import { createPinoLogger } from './infrastructure/logging/pino.logger.ts';
import { JsonFileUserRepository } from './infrastructure/persistence/json-file.user-repository.ts';
import { Argon2PasswordHasher } from './infrastructure/security/argon2.password-hasher.ts';
import { JoseTokenService } from './infrastructure/security/jose.token-service.ts';
import { cryptoIdGenerator } from './infrastructure/system/crypto.id-generator.ts';
import { systemClock } from './infrastructure/system/system.clock.ts';

export interface Infrastructure {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly logger: Logger;
  readonly users: UserRepository;
  readonly hasher: PasswordHasher;
  readonly tokens: TokenService;
}

export interface App {
  start(): Promise<{ readonly port: number }>;
  stop(): Promise<void>;
}

export async function createApp(
  config: AppConfig,
  overrides: Partial<Infrastructure> = {},
): Promise<App> {
  const clock = overrides.clock ?? systemClock;
  const ids = overrides.ids ?? cryptoIdGenerator;
  const logger =
    overrides.logger ??
    createPinoLogger({ level: config.logLevel, pretty: config.logFormat === 'pretty' });
  const users = overrides.users ?? (await JsonFileUserRepository.open(config.dataFile));
  const hasher = overrides.hasher ?? new Argon2PasswordHasher();
  const tokens =
    overrides.tokens ??
    new JoseTokenService({
      secret: config.jwt.secret,
      issuer: config.jwt.issuer,
      ttlSeconds: config.jwt.ttlSeconds,
      signature: config.tokenSignature,
      clock,
    });

  const server = createServer(
    createHttpApp({
      logger,
      bodyLimitBytes: config.bodyLimitBytes,
      staticDir: config.staticDir,
      authRateLimit: config.authRateLimit,
      registerUser: new RegisterUser({ users, hasher, tokens, ids, clock }),
      loginUser: new LoginUser({ users, hasher, tokens }),
      authenticateToken: new AuthenticateToken({ tokens, users }),
      listUsers: new ListUsers({ users }),
      changeUserRole: new ChangeUserRole({ users }),
      deleteUser: new DeleteUser({ users }),
    }),
  );

  return {
    async start() {
      return { port: await listen(server, config.port) };
    },
    async stop() {
      if (server.listening) {
        await close(server);
      }
    },
  };
}
```

## `api/src/application/authenticate-token.use-case.ts`

```typescript
import type { User } from '../domain/user.ts';
import type { AccessClaims, TokenService, UserRepository } from './ports.ts';
import { err, ok, type Result } from './result.ts';

export interface AuthContext {
  readonly user: User;
  readonly claims: AccessClaims;
}

export class AuthenticateToken {
  readonly #tokens: TokenService;
  readonly #users: UserRepository;

  constructor(deps: { tokens: TokenService; users: UserRepository }) {
    this.#tokens = deps.tokens;
    this.#users = deps.users;
  }

  async execute(token: string): Promise<Result<AuthContext>> {
    const verification = await this.#tokens.verify(token);
    if (!verification.ok) {
      return verification.reason === 'expired'
        ? err('TOKEN_EXPIRED', 'The token has expired')
        : err('INVALID_TOKEN', 'The token is invalid');
    }

    const user = await this.#users.findById(verification.claims.userId);
    if (!user) {
      return err('UNAUTHORIZED', 'The account no longer exists');
    }
    return ok({ user, claims: verification.claims });
  }
}
```

## `api/src/application/change-user-role.use-case.ts`

```typescript
import { withRole, type Role, type User, type UserId } from '../domain/user.ts';
import type { UserRepository } from './ports.ts';
import { err, ok, type Result } from './result.ts';

export class ChangeUserRole {
  readonly #users: UserRepository;

  constructor(deps: { users: UserRepository }) {
    this.#users = deps.users;
  }

  async execute(input: { userId: UserId; role: Role }): Promise<Result<User>> {
    const user = await this.#users.findById(input.userId);
    if (!user) {
      return err('NOT_FOUND', 'User not found');
    }
    if (user.role === input.role) {
      return ok(user);
    }
    if (user.role === 'admin' && (await this.#users.countByRole('admin')) === 1) {
      return err('LAST_ADMIN', 'The last administrator cannot lose the role');
    }

    const updated = withRole(user, input.role);
    await this.#users.update(updated);
    return ok(updated);
  }
}
```

## `api/src/application/delete-user.use-case.ts`

```typescript
import type { User, UserId } from '../domain/user.ts';
import type { UserRepository } from './ports.ts';
import { err, ok, type Result } from './result.ts';

export class DeleteUser {
  readonly #users: UserRepository;

  constructor(deps: { users: UserRepository }) {
    this.#users = deps.users;
  }

  async execute(input: { actorId: UserId; userId: UserId }): Promise<Result<User>> {
    if (input.actorId === input.userId) {
      return err('SELF_DELETE', 'Administrators cannot delete their own account');
    }
    const user = await this.#users.findById(input.userId);
    if (!user) {
      return err('NOT_FOUND', 'User not found');
    }
    if (user.role === 'admin' && (await this.#users.countByRole('admin')) === 1) {
      return err('LAST_ADMIN', 'The last administrator cannot be deleted');
    }

    await this.#users.remove(input.userId);
    return ok(user);
  }
}
```

## `api/src/application/list-users.use-case.ts`

```typescript
import type { User } from '../domain/user.ts';
import type { UserRepository } from './ports.ts';

export class ListUsers {
  readonly #users: UserRepository;

  constructor(deps: { users: UserRepository }) {
    this.#users = deps.users;
  }

  async execute(): Promise<readonly User[]> {
    const users = await this.#users.list();
    return [...users].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
}
```

## `api/src/application/login-user.use-case.ts`

```typescript
import { normalizeUsername } from '../domain/user.ts';
import type { PasswordHasher, TokenService, UserRepository } from './ports.ts';
import { err, ok, type Result } from './result.ts';
import type { Session } from './session.ts';

export class LoginUser {
  readonly #users: UserRepository;
  readonly #hasher: PasswordHasher;
  readonly #tokens: TokenService;
  #decoyHash: Promise<string> | null = null;

  constructor(deps: { users: UserRepository; hasher: PasswordHasher; tokens: TokenService }) {
    this.#users = deps.users;
    this.#hasher = deps.hasher;
    this.#tokens = deps.tokens;
  }

  async execute(input: { username: string; password: string }): Promise<Result<Session>> {
    const user = await this.#users.findByUsername(normalizeUsername(input.username));
    const passwordMatches = await this.#hasher.verify(
      input.password,
      user?.passwordHash ?? (await this.#decoy()),
    );
    if (!user || !passwordMatches) {
      return err('INVALID_CREDENTIALS', 'Wrong username or password');
    }

    const { token, expiresAt } = await this.#tokens.issue(user);
    return ok({ user, token, expiresAt });
  }

  #decoy(): Promise<string> {
    this.#decoyHash ??= this.#hasher.hash('decoy-password-for-unknown-users');
    return this.#decoyHash;
  }
}
```

## `api/src/application/ports.ts`

```typescript
import type { Role, User, UserId } from '../domain/user.ts';

export interface UserRepository {
  findById(id: UserId): Promise<User | undefined>;
  findByUsername(username: string): Promise<User | undefined>;
  list(): Promise<readonly User[]>;
  count(): Promise<number>;
  countByRole(role: Role): Promise<number>;
  add(user: User): Promise<boolean>;
  update(user: User): Promise<void>;
  remove(id: UserId): Promise<boolean>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

export interface AccessClaims {
  readonly userId: UserId;
  readonly username: string;
  readonly role: Role;
  readonly author: string;
  readonly group: string;
  readonly variant: number;
  readonly issuer: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

export interface IssuedToken {
  readonly token: string;
  readonly expiresAt: Date;
}

export type TokenVerification =
  | { readonly ok: true; readonly claims: AccessClaims }
  | { readonly ok: false; readonly reason: 'expired' | 'invalid' };

export interface TokenService {
  issue(user: User): Promise<IssuedToken>;
  verify(token: string): Promise<TokenVerification>;
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

## `api/src/application/register-user.use-case.ts`

```typescript
import { createUser, normalizeUsername, type Role } from '../domain/user.ts';
import type { Clock, IdGenerator, PasswordHasher, TokenService, UserRepository } from './ports.ts';
import { err, ok, type Result } from './result.ts';
import type { Session } from './session.ts';

export class RegisterUser {
  readonly #users: UserRepository;
  readonly #hasher: PasswordHasher;
  readonly #tokens: TokenService;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;

  constructor(deps: {
    users: UserRepository;
    hasher: PasswordHasher;
    tokens: TokenService;
    ids: IdGenerator;
    clock: Clock;
  }) {
    this.#users = deps.users;
    this.#hasher = deps.hasher;
    this.#tokens = deps.tokens;
    this.#ids = deps.ids;
    this.#clock = deps.clock;
  }

  async execute(input: { username: string; password: string }): Promise<Result<Session>> {
    const taken = err('USERNAME_TAKEN', 'This username is already taken');
    if (await this.#users.findByUsername(normalizeUsername(input.username))) {
      return taken;
    }

    const role: Role = (await this.#users.count()) === 0 ? 'admin' : 'user';
    const user = createUser({
      id: this.#ids.next(),
      username: input.username,
      passwordHash: await this.#hasher.hash(input.password),
      role,
      createdAt: this.#clock.now(),
    });
    if (!(await this.#users.add(user))) {
      return taken;
    }

    const { token, expiresAt } = await this.#tokens.issue(user);
    return ok({ user, token, expiresAt });
  }
}
```

## `api/src/application/result.ts`

```typescript
export type AppErrorCode =
  | 'USERNAME_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'UNAUTHORIZED'
  | 'TOKEN_EXPIRED'
  | 'INVALID_TOKEN'
  | 'NOT_FOUND'
  | 'LAST_ADMIN'
  | 'SELF_DELETE';

export interface AppError {
  readonly code: AppErrorCode;
  readonly message: string;
}

export type Result<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: AppError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err(code: AppErrorCode, message: string): Result<never> {
  return { ok: false, error: { code, message } };
}
```

## `api/src/application/session.ts`

```typescript
import type { User } from '../domain/user.ts';

export interface Session {
  readonly user: User;
  readonly token: string;
  readonly expiresAt: Date;
}
```

## `api/src/config.ts`

```typescript
import { z } from 'zod';
import type { LogLevel } from './application/ports.ts';

const DEVELOPMENT_JWT_SECRET = 'development-only-secret-do-not-use-in-production';
const JWT_SECRET_MIN_LENGTH = 32;

export type Environment = 'development' | 'production' | 'test';

export type LogFormat = 'pretty' | 'json';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
    DATA_FILE: z.string().trim().min(1).default('data/users.json'),
    JWT_SECRET: z.string().min(JWT_SECRET_MIN_LENGTH).optional(),
    JWT_ISSUER: z.string().trim().min(1).default('lab-02-jwt-auth'),
    JWT_TTL_SECONDS: z.coerce.number().int().min(1).max(86_400).default(71),
    TOKEN_AUTHOR: z.string().trim().min(1).default('Жуков В.В.'),
    TOKEN_GROUP: z.string().trim().min(1).default('ІС-33'),
    TOKEN_VARIANT: z.coerce.number().int().min(1).default(11),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),
    STATIC_DIR: z.string().trim().min(1).optional(),
  })
  .refine((vars) => vars.NODE_ENV !== 'production' || vars.JWT_SECRET !== undefined, {
    path: ['JWT_SECRET'],
    message: `JWT_SECRET is required in production (at least ${JWT_SECRET_MIN_LENGTH} characters)`,
  });

export interface AppConfig {
  readonly environment: Environment;
  readonly port: number;
  readonly dataFile: string;
  readonly bodyLimitBytes: number;
  readonly jwt: {
    readonly secret: string;
    readonly issuer: string;
    readonly ttlSeconds: number;
  };
  readonly tokenSignature: {
    readonly author: string;
    readonly group: string;
    readonly variant: number;
  };
  readonly authRateLimit: { readonly max: number; readonly windowMs: number };
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
    dataFile: vars.DATA_FILE,
    bodyLimitBytes: 16 * 1024,
    jwt: {
      secret: vars.JWT_SECRET ?? DEVELOPMENT_JWT_SECRET,
      issuer: vars.JWT_ISSUER,
      ttlSeconds: vars.JWT_TTL_SECONDS,
    },
    tokenSignature: {
      author: vars.TOKEN_AUTHOR,
      group: vars.TOKEN_GROUP,
      variant: vars.TOKEN_VARIANT,
    },
    authRateLimit: { max: vars.AUTH_RATE_LIMIT_MAX, windowMs: vars.AUTH_RATE_LIMIT_WINDOW_MS },
    logLevel: vars.LOG_LEVEL ?? (vars.NODE_ENV === 'production' ? 'info' : 'debug'),
    logFormat: vars.NODE_ENV === 'development' ? 'pretty' : 'json',
    staticDir: vars.STATIC_DIR,
  };
}
```

## `api/src/domain/domain-error.ts`

```typescript
export class DomainError extends Error {
  override readonly name = 'DomainError';
}
```

## `api/src/domain/user.ts`

```typescript
import { DomainError } from './domain-error.ts';

export type UserId = string & { readonly __brand: 'UserId' };

export const ROLES = ['user', 'admin'] as const;

export type Role = (typeof ROLES)[number];

export interface User {
  readonly id: UserId;
  readonly username: string;
  readonly passwordHash: string;
  readonly role: Role;
  readonly createdAt: Date;
}

export const USERNAME_PATTERN = /^[\p{L}\p{N}_.-]{3,32}$/u;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function createUser(props: {
  id: string;
  username: string;
  passwordHash: string;
  role: Role;
  createdAt: Date;
}): User {
  const username = normalizeUsername(props.username);
  if (!USERNAME_PATTERN.test(username)) {
    throw new DomainError(`Invalid username: ${JSON.stringify(props.username)}`);
  }
  if (props.passwordHash.length === 0) {
    throw new DomainError('A user must have a password hash');
  }
  const user: User = {
    id: props.id as UserId,
    username,
    passwordHash: props.passwordHash,
    role: props.role,
    createdAt: props.createdAt,
  };
  return Object.freeze(user);
}

export function withRole(user: User, role: Role): User {
  return Object.freeze({ ...user, role });
}
```

## `api/src/infrastructure/http/auth.guard.ts`

```typescript
import type { RequestHandler, Response } from 'express';
import type {
  AuthContext,
  AuthenticateToken,
} from '../../application/authenticate-token.use-case.ts';
import type { Role } from '../../domain/user.ts';
import { sendAppError, sendError } from './errors.ts';

const BEARER_TOKEN = /^Bearer +(\S+) *$/i;

export interface AuthGuards {
  readonly authenticate: RequestHandler;
  authorize(...roles: Role[]): RequestHandler;
}

export function createAuthGuards(authenticateToken: AuthenticateToken): AuthGuards {
  return {
    async authenticate(request, response, next) {
      const token = BEARER_TOKEN.exec(request.get('Authorization') ?? '')?.[1];
      if (!token) {
        response.set('WWW-Authenticate', 'Bearer');
        sendError(
          response,
          401,
          'UNAUTHORIZED',
          'The Authorization header with a Bearer token is required',
        );
        return;
      }

      const result = await authenticateToken.execute(token);
      if (!result.ok) {
        response.set('WWW-Authenticate', 'Bearer error="invalid_token"');
        sendAppError(response, result.error);
        return;
      }
      response.locals.auth = result.value;
      next();
    },

    authorize(...roles: Role[]) {
      return (_request, response, next) => {
        if (!roles.includes(currentAuth(response).user.role)) {
          sendError(
            response,
            403,
            'FORBIDDEN',
            `This action requires the role: ${roles.join(', ')}`,
          );
          return;
        }
        next();
      };
    },
  };
}

export function currentAuth(response: Response): AuthContext {
  const auth: AuthContext | undefined = response.locals.auth;
  if (!auth) {
    throw new Error('The route is not protected by the authenticate guard');
  }
  return auth;
}
```

## `api/src/infrastructure/http/contract.ts`

```typescript
export type * from '../../../../contracts/auth.contract.ts';
```

## `api/src/infrastructure/http/errors.ts`

```typescript
import type { Response } from 'express';
import type { AppError, AppErrorCode } from '../../application/result.ts';
import type { ErrorCode, ErrorResponse } from './contract.ts';

const STATUS_BY_APP_ERROR: Readonly<Record<AppErrorCode, number>> = {
  USERNAME_TAKEN: 409,
  INVALID_CREDENTIALS: 401,
  UNAUTHORIZED: 401,
  TOKEN_EXPIRED: 401,
  INVALID_TOKEN: 401,
  NOT_FOUND: 404,
  LAST_ADMIN: 409,
  SELF_DELETE: 409,
};

export class RequestValidationError extends Error {
  override readonly name = 'RequestValidationError';
}

export function sendError(
  response: Response,
  statusCode: number,
  code: ErrorCode,
  message: string,
): void {
  const body: ErrorResponse = { error: { code, message } };
  response.status(statusCode).json(body);
}

export function sendAppError(response: Response, error: AppError): void {
  sendError(response, STATUS_BY_APP_ERROR[error.code], error.code, error.message);
}
```

## `api/src/infrastructure/http/mappers.ts`

```typescript
import type { AccessClaims } from '../../application/ports.ts';
import type { Session } from '../../application/session.ts';
import type { User } from '../../domain/user.ts';
import type { AuthResponse, TokenClaimsDto, UserDto } from './contract.ts';

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toClaimsDto(claims: AccessClaims): TokenClaimsDto {
  return {
    sub: claims.userId,
    username: claims.username,
    role: claims.role,
    author: claims.author,
    group: claims.group,
    variant: claims.variant,
    iss: claims.issuer,
    iat: toEpochSeconds(claims.issuedAt),
    exp: toEpochSeconds(claims.expiresAt),
  };
}

export function toAuthResponse(session: Session): AuthResponse {
  return {
    token: session.token,
    expiresAt: session.expiresAt.toISOString(),
    user: toUserDto(session.user),
  };
}

function toEpochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
```

## `api/src/infrastructure/http/routes/auth.routes.ts`

```typescript
import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { LoginUser } from '../../../application/login-user.use-case.ts';
import type { RegisterUser } from '../../../application/register-user.use-case.ts';
import { sendAppError, sendError } from '../errors.ts';
import { toAuthResponse } from '../mappers.ts';
import { loginSchema, parseInput, registerSchema } from '../schemas.ts';

export interface AuthRoutesDeps {
  readonly registerUser: RegisterUser;
  readonly loginUser: LoginUser;
  readonly rateLimit: { readonly max: number; readonly windowMs: number };
}

export function authRoutes(deps: AuthRoutesDeps): Router {
  const router = Router();
  const limitAttempts = (): RequestHandler =>
    rateLimit({
      windowMs: deps.rateLimit.windowMs,
      limit: deps.rateLimit.max,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_request, response) => {
        sendError(response, 429, 'RATE_LIMITED', 'Too many attempts, try again later');
      },
    });

  router.post('/auth/register', limitAttempts(), async (request, response) => {
    const result = await deps.registerUser.execute(parseInput(registerSchema, request.body));
    if (!result.ok) {
      sendAppError(response, result.error);
      return;
    }
    response.status(201).json(toAuthResponse(result.value));
  });

  router.post('/auth/login', limitAttempts(), async (request, response) => {
    const result = await deps.loginUser.execute(parseInput(loginSchema, request.body));
    if (!result.ok) {
      sendAppError(response, result.error);
      return;
    }
    response.json(toAuthResponse(result.value));
  });

  return router;
}
```

## `api/src/infrastructure/http/routes/me.routes.ts`

```typescript
import { Router } from 'express';
import { currentAuth, type AuthGuards } from '../auth.guard.ts';
import type { ProfileResponse } from '../contract.ts';
import { toClaimsDto, toUserDto } from '../mappers.ts';

export function meRoutes(deps: { readonly guards: AuthGuards }): Router {
  const router = Router();

  router.get('/me', deps.guards.authenticate, (_request, response) => {
    const { user, claims } = currentAuth(response);
    const body: ProfileResponse = { user: toUserDto(user), claims: toClaimsDto(claims) };
    response.json(body);
  });

  return router;
}
```

## `api/src/infrastructure/http/routes/users.routes.ts`

```typescript
import { Router } from 'express';
import type { ChangeUserRole } from '../../../application/change-user-role.use-case.ts';
import type { DeleteUser } from '../../../application/delete-user.use-case.ts';
import type { ListUsers } from '../../../application/list-users.use-case.ts';
import type { UserId } from '../../../domain/user.ts';
import { currentAuth, type AuthGuards } from '../auth.guard.ts';
import type { UserResponse, UsersResponse } from '../contract.ts';
import { sendAppError } from '../errors.ts';
import { toUserDto } from '../mappers.ts';
import { changeRoleSchema, parseInput, userIdParamsSchema } from '../schemas.ts';

export interface UsersRoutesDeps {
  readonly guards: AuthGuards;
  readonly listUsers: ListUsers;
  readonly changeUserRole: ChangeUserRole;
  readonly deleteUser: DeleteUser;
}

export function usersRoutes(deps: UsersRoutesDeps): Router {
  const router = Router();
  router.use('/users', deps.guards.authenticate, deps.guards.authorize('admin'));

  router.get('/users', async (_request, response) => {
    const users = await deps.listUsers.execute();
    const body: UsersResponse = { users: users.map(toUserDto) };
    response.json(body);
  });

  router.patch('/users/:id/role', async (request, response) => {
    const { id } = parseInput(userIdParamsSchema, request.params);
    const { role } = parseInput(changeRoleSchema, request.body);
    const result = await deps.changeUserRole.execute({ userId: id as UserId, role });
    if (!result.ok) {
      sendAppError(response, result.error);
      return;
    }
    const body: UserResponse = { user: toUserDto(result.value) };
    response.json(body);
  });

  router.delete('/users/:id', async (request, response) => {
    const { id } = parseInput(userIdParamsSchema, request.params);
    const result = await deps.deleteUser.execute({
      actorId: currentAuth(response).user.id,
      userId: id as UserId,
    });
    if (!result.ok) {
      sendAppError(response, result.error);
      return;
    }
    const body: UserResponse = { user: toUserDto(result.value) };
    response.json(body);
  });

  return router;
}
```

## `api/src/infrastructure/http/schemas.ts`

```typescript
import { z } from 'zod';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  ROLES,
  USERNAME_PATTERN,
} from '../../domain/user.ts';
import { RequestValidationError } from './errors.ts';

export const registerSchema = z.strictObject({
  username: z
    .string()
    .trim()
    .regex(USERNAME_PATTERN, 'Username must be 3-32 letters, digits, dots, dashes or underscores'),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH)
    .max(PASSWORD_MAX_LENGTH)
    .regex(/\S/, 'Password must not consist of spaces only'),
});

export const loginSchema = z.strictObject({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export const changeRoleSchema = z.strictObject({
  role: z.enum(ROLES),
});

export const userIdParamsSchema = z.object({
  id: z.string().min(1).max(64),
});

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    throw new RequestValidationError(
      result.error.issues
        .map(
          (issue) => `${issue.path.length > 0 ? issue.path.join('.') : 'body'}: ${issue.message}`,
        )
        .join('; '),
    );
  }
  return result.data;
}
```

## `api/src/infrastructure/http/server.ts`

```typescript
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import type { AuthenticateToken } from '../../application/authenticate-token.use-case.ts';
import type { ChangeUserRole } from '../../application/change-user-role.use-case.ts';
import type { DeleteUser } from '../../application/delete-user.use-case.ts';
import type { ListUsers } from '../../application/list-users.use-case.ts';
import type { LoginUser } from '../../application/login-user.use-case.ts';
import type { Logger } from '../../application/ports.ts';
import type { RegisterUser } from '../../application/register-user.use-case.ts';
import { createAuthGuards } from './auth.guard.ts';
import { RequestValidationError, sendError } from './errors.ts';
import { authRoutes } from './routes/auth.routes.ts';
import { meRoutes } from './routes/me.routes.ts';
import { usersRoutes } from './routes/users.routes.ts';

const API_PREFIX = '/api';
const HASHED_ASSET = /-[A-Z0-9]{8,}\.[a-z0-9]+$/;
const BODY_ERRORS: Readonly<Record<string, string>> = {
  'entity.parse.failed': 'The request body is not valid JSON',
  'entity.too.large': 'The request body is too large',
};

export interface HttpAppDeps {
  readonly logger: Logger;
  readonly bodyLimitBytes: number;
  readonly staticDir: string | undefined;
  readonly authRateLimit: { readonly max: number; readonly windowMs: number };
  readonly registerUser: RegisterUser;
  readonly loginUser: LoginUser;
  readonly authenticateToken: AuthenticateToken;
  readonly listUsers: ListUsers;
  readonly changeUserRole: ChangeUserRole;
  readonly deleteUser: DeleteUser;
}

export function createHttpApp(deps: HttpAppDeps): Express {
  const app = express();
  const logger = deps.logger.child({ component: 'http' });
  const guards = createAuthGuards(deps.authenticateToken);

  app.disable('x-powered-by');
  app.use(logRequests(logger));
  app.use((_request, response, next) => {
    response.set('X-Content-Type-Options', 'nosniff');
    next();
  });

  const api = express.Router();
  api.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  api.use(express.json({ limit: deps.bodyLimitBytes }));
  api.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });
  api.use(
    authRoutes({
      registerUser: deps.registerUser,
      loginUser: deps.loginUser,
      rateLimit: deps.authRateLimit,
    }),
  );
  api.use(meRoutes({ guards }));
  api.use(
    usersRoutes({
      guards,
      listUsers: deps.listUsers,
      changeUserRole: deps.changeUserRole,
      deleteUser: deps.deleteUser,
    }),
  );
  api.use(notFound);
  app.use(API_PREFIX, api);

  if (deps.staticDir) {
    app.use(serveClient(deps.staticDir));
  }
  app.use(notFound);
  app.use(handleErrors(logger));

  return app;
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

export function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function logRequests(logger: Logger): RequestHandler {
  return (request, response, next) => {
    const startedAt = performance.now();
    response.on('finish', () => {
      const context = {
        method: request.method,
        url: request.originalUrl,
        statusCode: response.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      };
      if (request.originalUrl.startsWith(API_PREFIX)) {
        logger.info('Request completed', context);
      } else {
        logger.debug('Request completed', context);
      }
    });
    next();
  };
}

function serveClient(staticDir: string): RequestHandler[] {
  const root = path.resolve(staticDir);
  const index = path.join(root, 'index.html');
  if (!existsSync(index)) {
    throw new Error(`STATIC_DIR does not contain index.html: ${root}`);
  }
  return [
    express.static(root, {
      cacheControl: false,
      setHeaders: (response, file) => {
        response.setHeader(
          'Cache-Control',
          HASHED_ASSET.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    }),
    (request, response, next) => {
      const isPage = request.method === 'GET' || request.method === 'HEAD';
      if (!isPage || path.extname(request.path) !== '') {
        next();
        return;
      }
      response.set('Cache-Control', 'no-cache');
      response.sendFile(index);
    },
  ];
}

const notFound: RequestHandler = (request, response) => {
  sendError(response, 404, 'NOT_FOUND', `Route ${request.method} ${request.originalUrl} not found`);
};

function handleErrors(logger: Logger): ErrorRequestHandler {
  return (error: unknown, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    if (error instanceof RequestValidationError) {
      sendError(response, 400, 'VALIDATION_ERROR', error.message);
      return;
    }
    const { status, type, message } = describeHttpError(error);
    if (status >= 400 && status < 500) {
      sendError(response, status, 'VALIDATION_ERROR', BODY_ERRORS[type] ?? message);
      return;
    }
    logger.error('Request failed', { error, method: request.method, url: request.originalUrl });
    sendError(response, 500, 'INTERNAL_ERROR', 'Internal server error');
  };
}

function describeHttpError(error: unknown): { status: number; type: string; message: string } {
  const details = (typeof error === 'object' && error !== null ? error : {}) as {
    status?: unknown;
    type?: unknown;
    message?: unknown;
  };
  return {
    status: typeof details.status === 'number' ? details.status : 500,
    type: typeof details.type === 'string' ? details.type : '',
    message: typeof details.message === 'string' ? details.message : 'Bad request',
  };
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

## `api/src/infrastructure/persistence/in-memory.user-repository.ts`

```typescript
import type { UserRepository } from '../../application/ports.ts';
import type { Role, User, UserId } from '../../domain/user.ts';

export class InMemoryUserRepository implements UserRepository {
  readonly #byId = new Map<UserId, User>();

  constructor(initial: readonly User[] = []) {
    for (const user of initial) {
      this.#byId.set(user.id, user);
    }
  }

  async findById(id: UserId): Promise<User | undefined> {
    return this.#byId.get(id);
  }

  async findByUsername(username: string): Promise<User | undefined> {
    for (const user of this.#byId.values()) {
      if (user.username === username) {
        return user;
      }
    }
    return undefined;
  }

  async list(): Promise<readonly User[]> {
    return [...this.#byId.values()];
  }

  async count(): Promise<number> {
    return this.#byId.size;
  }

  async countByRole(role: Role): Promise<number> {
    let total = 0;
    for (const user of this.#byId.values()) {
      if (user.role === role) {
        total += 1;
      }
    }
    return total;
  }

  async add(user: User): Promise<boolean> {
    if (this.#byId.has(user.id) || (await this.findByUsername(user.username))) {
      return false;
    }
    this.#byId.set(user.id, user);
    return true;
  }

  async update(user: User): Promise<void> {
    if (this.#byId.has(user.id)) {
      this.#byId.set(user.id, user);
    }
  }

  async remove(id: UserId): Promise<boolean> {
    return this.#byId.delete(id);
  }
}
```

## `api/src/infrastructure/persistence/json-file.user-repository.ts`

```typescript
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { UserRepository } from '../../application/ports.ts';
import { createUser, ROLES, type Role, type User, type UserId } from '../../domain/user.ts';
import { InMemoryUserRepository } from './in-memory.user-repository.ts';

const fileSchema = z.object({
  users: z.array(
    z.object({
      id: z.string().min(1),
      username: z.string(),
      passwordHash: z.string(),
      role: z.enum(ROLES),
      createdAt: z.iso.datetime(),
    }),
  ),
});

export class JsonFileUserRepository implements UserRepository {
  readonly #file: string;
  readonly #memory: InMemoryUserRepository;
  #writes: Promise<void> = Promise.resolve();

  private constructor(file: string, memory: InMemoryUserRepository) {
    this.#file = file;
    this.#memory = memory;
  }

  static async open(file: string): Promise<JsonFileUserRepository> {
    const absolute = path.resolve(file);
    return new JsonFileUserRepository(
      absolute,
      new InMemoryUserRepository(await readUsers(absolute)),
    );
  }

  findById(id: UserId): Promise<User | undefined> {
    return this.#memory.findById(id);
  }

  findByUsername(username: string): Promise<User | undefined> {
    return this.#memory.findByUsername(username);
  }

  list(): Promise<readonly User[]> {
    return this.#memory.list();
  }

  count(): Promise<number> {
    return this.#memory.count();
  }

  countByRole(role: Role): Promise<number> {
    return this.#memory.countByRole(role);
  }

  async add(user: User): Promise<boolean> {
    const added = await this.#memory.add(user);
    if (added) {
      await this.#persist();
    }
    return added;
  }

  async update(user: User): Promise<void> {
    await this.#memory.update(user);
    await this.#persist();
  }

  async remove(id: UserId): Promise<boolean> {
    const removed = await this.#memory.remove(id);
    if (removed) {
      await this.#persist();
    }
    return removed;
  }

  #persist(): Promise<void> {
    const next = this.#writes.then(() => this.#write());
    this.#writes = next.catch(() => undefined);
    return next;
  }

  async #write(): Promise<void> {
    const users = await this.#memory.list();
    const content = JSON.stringify(
      {
        users: users.map((user) => ({
          id: user.id,
          username: user.username,
          passwordHash: user.passwordHash,
          role: user.role,
          createdAt: user.createdAt.toISOString(),
        })),
      },
      null,
      2,
    );
    await mkdir(path.dirname(this.#file), { recursive: true });
    const temporary = `${this.#file}.${process.pid}.tmp`;
    await writeFile(temporary, `${content}\n`, { mode: 0o600 });
    await rename(temporary, this.#file);
  }
}

async function readUsers(file: string): Promise<User[]> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const parsed = fileSchema.parse(JSON.parse(raw));
  return parsed.users.map((user) => createUser({ ...user, createdAt: new Date(user.createdAt) }));
}
```

## `api/src/infrastructure/security/argon2.password-hasher.ts`

```typescript
import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PasswordHasher } from '../../application/ports.ts';

export interface Argon2Options {
  readonly memoryKiB: number;
  readonly passes: number;
  readonly parallelism: number;
  readonly saltBytes: number;
  readonly hashBytes: number;
}

export const OWASP_ARGON2ID: Argon2Options = {
  memoryKiB: 19_456,
  passes: 2,
  parallelism: 1,
  saltBytes: 16,
  hashBytes: 32,
};

const ALGORITHM = 'argon2id';
const VERSION = 19;

interface ParsedHash {
  readonly memoryKiB: number;
  readonly passes: number;
  readonly parallelism: number;
  readonly salt: Buffer;
  readonly hash: Buffer;
}

export class Argon2PasswordHasher implements PasswordHasher {
  readonly #options: Argon2Options;

  constructor(options: Argon2Options = OWASP_ARGON2ID) {
    this.#options = options;
  }

  async hash(password: string): Promise<string> {
    const { memoryKiB, passes, parallelism, saltBytes, hashBytes } = this.#options;
    const salt = randomBytes(saltBytes);
    const hash = await derive(password, { memoryKiB, passes, parallelism, salt, hashBytes });
    return [
      '',
      ALGORITHM,
      `v=${VERSION}`,
      `m=${memoryKiB},t=${passes},p=${parallelism}`,
      toPhcBase64(salt),
      toPhcBase64(hash),
    ].join('$');
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    const parsed = parse(encoded);
    if (!parsed) {
      return false;
    }
    const actual = await derive(password, { ...parsed, hashBytes: parsed.hash.length });
    return timingSafeEqual(actual, parsed.hash);
  }
}

function derive(
  password: string,
  params: {
    memoryKiB: number;
    passes: number;
    parallelism: number;
    salt: Buffer;
    hashBytes: number;
  },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      ALGORITHM,
      {
        message: password,
        nonce: params.salt,
        memory: params.memoryKiB,
        passes: params.passes,
        parallelism: params.parallelism,
        tagLength: params.hashBytes,
      },
      (error, derivedKey) => (error ? reject(error) : resolve(derivedKey)),
    );
  });
}

function parse(encoded: string): ParsedHash | undefined {
  const parts = encoded.split('$');
  if (
    parts.length !== 6 ||
    parts[0] !== '' ||
    parts[1] !== ALGORITHM ||
    parts[2] !== `v=${VERSION}`
  ) {
    return undefined;
  }
  const params = /^m=(\d+),t=(\d+),p=(\d+)$/.exec(parts[3] ?? '');
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const hash = Buffer.from(parts[5] ?? '', 'base64');
  if (!params || salt.length < 8 || hash.length < 16) {
    return undefined;
  }
  return {
    memoryKiB: Number(params[1]),
    passes: Number(params[2]),
    parallelism: Number(params[3]),
    salt,
    hash,
  };
}

function toPhcBase64(bytes: Buffer): string {
  return bytes.toString('base64').replace(/=+$/, '');
}
```

## `api/src/infrastructure/security/jose.token-service.ts`

```typescript
import { errors, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import type {
  AccessClaims,
  Clock,
  IssuedToken,
  TokenService,
  TokenVerification,
} from '../../application/ports.ts';
import { ROLES, type User, type UserId } from '../../domain/user.ts';

export interface TokenSignature {
  readonly author: string;
  readonly group: string;
  readonly variant: number;
}

export interface JoseTokenServiceOptions {
  readonly secret: string;
  readonly issuer: string;
  readonly ttlSeconds: number;
  readonly signature: TokenSignature;
  readonly clock: Clock;
}

const ALGORITHM = 'HS256';

const payloadSchema = z.object({
  sub: z.string().min(1),
  iss: z.string().min(1),
  iat: z.number().int(),
  exp: z.number().int(),
  username: z.string().min(1),
  role: z.enum(ROLES),
  author: z.string(),
  group: z.string(),
  variant: z.number().int(),
});

export class JoseTokenService implements TokenService {
  readonly #key: Uint8Array;
  readonly #issuer: string;
  readonly #ttlSeconds: number;
  readonly #signature: TokenSignature;
  readonly #clock: Clock;

  constructor(options: JoseTokenServiceOptions) {
    this.#key = new TextEncoder().encode(options.secret);
    this.#issuer = options.issuer;
    this.#ttlSeconds = options.ttlSeconds;
    this.#signature = options.signature;
    this.#clock = options.clock;
  }

  async issue(user: User): Promise<IssuedToken> {
    const issuedAt = Math.floor(this.#clock.now().getTime() / 1000);
    const expiresAt = issuedAt + this.#ttlSeconds;
    const token = await new SignJWT({
      username: user.username,
      role: user.role,
      author: this.#signature.author,
      group: this.#signature.group,
      variant: this.#signature.variant,
    })
      .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
      .setSubject(user.id)
      .setIssuer(this.#issuer)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(this.#key);
    return { token, expiresAt: new Date(expiresAt * 1000) };
  }

  async verify(token: string): Promise<TokenVerification> {
    try {
      const { payload } = await jwtVerify(token, this.#key, {
        algorithms: [ALGORITHM],
        issuer: this.#issuer,
        typ: 'JWT',
        requiredClaims: ['sub', 'iat', 'exp'],
        currentDate: this.#clock.now(),
      });
      const parsed = payloadSchema.safeParse(payload);
      if (!parsed.success) {
        return { ok: false, reason: 'invalid' };
      }
      return { ok: true, claims: toAccessClaims(parsed.data) };
    } catch (error) {
      if (error instanceof errors.JWTExpired) {
        return { ok: false, reason: 'expired' };
      }
      if (error instanceof errors.JOSEError || error instanceof TypeError) {
        return { ok: false, reason: 'invalid' };
      }
      throw error;
    }
  }
}

function toAccessClaims(payload: z.infer<typeof payloadSchema>): AccessClaims {
  return {
    userId: payload.sub as UserId,
    username: payload.username,
    role: payload.role,
    author: payload.author,
    group: payload.group,
    variant: payload.variant,
    issuer: payload.iss,
    issuedAt: new Date(payload.iat * 1000),
    expiresAt: new Date(payload.exp * 1000),
  };
}
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

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { error: reason });
  process.exit(1);
});

const app = await createApp(config, { logger });

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
logger.info('Auth server listening', {
  environment: config.environment,
  port,
  dataFile: config.dataFile,
  staticDir: config.staticDir ?? null,
  tokenTtlSeconds: config.jwt.ttlSeconds,
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
  }
}
```

## `web/proxy.conf.json`

```json
{
  "/api": {
    "target": "http://localhost:3000"
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
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { authInterceptor } from './auth/data-access/auth-interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor])),
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
import { adminGuard, authGuard, guestGuard } from './auth/data-access/auth-guards';
import { AdminUsers } from './auth/ui/admin-users/admin-users';
import { AuthPage } from './auth/ui/auth-page/auth-page';
import { Dashboard } from './auth/ui/dashboard/dashboard';
import { Shell } from './auth/ui/shell/shell';

export const routes: Routes = [
  {
    path: 'login',
    component: AuthPage,
    canActivate: [guestGuard],
    data: { mode: 'login' },
    title: 'Вхід · JWT-авторизація',
  },
  {
    path: 'register',
    component: AuthPage,
    canActivate: [guestGuard],
    data: { mode: 'register' },
    title: 'Реєстрація · JWT-авторизація',
  },
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'profile' },
      { path: 'profile', component: Dashboard, title: 'Профіль · JWT-авторизація' },
      {
        path: 'users',
        component: AdminUsers,
        canActivate: [adminGuard],
        title: 'Користувачі · JWT-авторизація',
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

## `web/src/app/auth/data-access/api-errors.ts`

```typescript
import { HttpErrorResponse } from '@angular/common/http';
import type { ErrorCode, ErrorResponse } from './contract';

const MESSAGES: Readonly<Record<ErrorCode, string>> = {
  VALIDATION_ERROR: 'Перевірте правильність заповнення полів',
  USERNAME_TAKEN: 'Це ім’я користувача вже зайняте',
  INVALID_CREDENTIALS: 'Неправильне ім’я користувача або пароль',
  UNAUTHORIZED: 'Потрібна авторизація',
  TOKEN_EXPIRED: 'Термін дії токена минув',
  INVALID_TOKEN: 'Токен недійсний',
  FORBIDDEN: 'Недостатньо прав для цієї дії',
  NOT_FOUND: 'Користувача не знайдено',
  LAST_ADMIN: 'Має залишитися хоча б один адміністратор',
  SELF_DELETE: 'Не можна видалити власний обліковий запис',
  RATE_LIMITED: 'Забагато спроб. Спробуйте трохи пізніше',
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

## `web/src/app/auth/data-access/auth-api.ts`

```typescript
import { HttpClient, HttpContext, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiErrorCode } from './api-errors';
import { SKIP_AUTH } from './auth-interceptor';
import type { AuthResponse, CredentialsRequest, ErrorCode, Role, UserResponse } from './contract';

export interface ProbeResult {
  readonly status: number;
  readonly code: ErrorCode | null;
}

@Injectable({ providedIn: 'root' })
export class AuthApi {
  readonly #http = inject(HttpClient);

  register(credentials: CredentialsRequest): Promise<AuthResponse> {
    return firstValueFrom(this.#http.post<AuthResponse>('/api/auth/register', credentials));
  }

  login(credentials: CredentialsRequest): Promise<AuthResponse> {
    return firstValueFrom(this.#http.post<AuthResponse>('/api/auth/login', credentials));
  }

  changeRole(userId: string, role: Role): Promise<UserResponse> {
    return firstValueFrom(
      this.#http.patch<UserResponse>(`/api/users/${encodeURIComponent(userId)}/role`, { role }),
    );
  }

  deleteUser(userId: string): Promise<UserResponse> {
    return firstValueFrom(
      this.#http.delete<UserResponse>(`/api/users/${encodeURIComponent(userId)}`),
    );
  }

  async probe(url: string, token: string | null): Promise<ProbeResult> {
    const headers = token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : undefined;
    try {
      const response = await firstValueFrom(
        this.#http.get(url, {
          headers,
          observe: 'response',
          context: new HttpContext().set(SKIP_AUTH, true),
        }),
      );
      return { status: response.status, code: null };
    } catch (error) {
      if (error instanceof HttpErrorResponse) {
        return { status: error.status, code: apiErrorCode(error) };
      }
      throw error;
    }
  }
}
```

## `web/src/app/auth/data-access/auth-guards.ts`

```typescript
import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthStore } from './auth-store';

export const authGuard: CanActivateFn = () =>
  inject(AuthStore).isAuthenticated() || inject(Router).createUrlTree(['/login']);

export const guestGuard: CanActivateFn = () =>
  !inject(AuthStore).isAuthenticated() || inject(Router).createUrlTree(['/profile']);

export const adminGuard: CanActivateFn = () =>
  inject(AuthStore).isAdmin() || inject(Router).createUrlTree(['/profile']);
```

## `web/src/app/auth/data-access/auth-interceptor.ts`

```typescript
import { HttpContextToken, HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { apiErrorCode } from './api-errors';
import { AuthStore, EXPIRED_NOTICE } from './auth-store';

export const SKIP_AUTH = new HttpContextToken<boolean>(() => false);

const SIGN_OUT_NOTICES: Readonly<Record<string, string>> = {
  TOKEN_EXPIRED: EXPIRED_NOTICE,
  INVALID_TOKEN: 'Сервер не прийняв токен. Увійдіть знову.',
  UNAUTHORIZED: 'Обліковий запис більше не існує або сесія недійсна.',
};

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (request.context.get(SKIP_AUTH) || !request.url.startsWith('/api/')) {
    return next(request);
  }

  const store = inject(AuthStore);
  const token = store.token();
  const authorized = token
    ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : request;

  return next(authorized).pipe(
    catchError((error: unknown) => {
      if (token && error instanceof HttpErrorResponse && error.status === 401) {
        store.signOut(SIGN_OUT_NOTICES[apiErrorCode(error) ?? 'UNAUTHORIZED'] ?? null);
      }
      return throwError(() => error);
    }),
  );
};
```

## `web/src/app/auth/data-access/auth-rules.ts`

```typescript
export const USERNAME_PATTERN = /^[\p{L}\p{N}_.-]{3,32}$/u;
export const USERNAME_HINT = '3–32 символи: літери, цифри, крапка, дефіс або підкреслення';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_HINT = `від ${PASSWORD_MIN_LENGTH} до ${PASSWORD_MAX_LENGTH} символів, не лише пробіли`;

export const ROLE_LABELS = {
  user: 'Користувач',
  admin: 'Адміністратор',
} as const;
```

## `web/src/app/auth/data-access/auth-store.ts`

```typescript
import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import type { AuthResponse, UserDto } from './contract';
import { decodeJwt } from './jwt';
import { SESSION_STORAGE } from './session-storage';

const STORAGE_KEY = 'jwt-auth.session';
const TICK_MS = 1000;

export const EXPIRED_NOTICE = 'Термін дії токена минув. Увійдіть знову.';

export interface Session {
  readonly token: string;
  readonly expiresAt: number;
  readonly user: UserDto;
}

@Injectable({ providedIn: 'root' })
export class AuthStore {
  readonly #storage = inject(SESSION_STORAGE);

  readonly #session = signal<Session | null>(this.#restore());
  readonly #now = signal(Date.now());
  readonly #notice = signal<string | null>(null);

  readonly notice = this.#notice.asReadonly();
  readonly user = computed(() => this.#session()?.user ?? null);
  readonly token = computed(() => this.#session()?.token ?? null);
  readonly isAuthenticated = computed(() => this.#session() !== null);
  readonly isAdmin = computed(() => this.user()?.role === 'admin');
  readonly lifetimeSeconds = computed(() => {
    const token = this.token();
    const claims = token ? decodeJwt(token)?.payload : undefined;
    return claims ? claims.exp - claims.iat : 0;
  });
  readonly secondsLeft = computed(() => {
    const session = this.#session();
    return session ? Math.max(0, Math.ceil((session.expiresAt - this.#now()) / 1000)) : 0;
  });

  constructor() {
    effect((onCleanup) => {
      const expiresAt = this.#session()?.expiresAt;
      if (expiresAt === undefined) {
        return;
      }
      const tick = () => {
        const now = Date.now();
        this.#now.set(now);
        if (now >= expiresAt) {
          this.signOut(EXPIRED_NOTICE);
        }
      };
      tick();
      const timer = setInterval(tick, TICK_MS);
      onCleanup(() => clearInterval(timer));
    });
  }

  signIn(response: AuthResponse): void {
    this.#notice.set(null);
    this.#save({
      token: response.token,
      expiresAt: localExpiry(response, Date.now()),
      user: response.user,
    });
  }

  updateUser(user: UserDto): void {
    const session = untracked(this.#session);
    if (session && session.user.id === user.id && !sameUser(session.user, user)) {
      this.#save({ ...session, user });
    }
  }

  signOut(notice: string | null = null): void {
    this.#notice.set(notice);
    this.#save(null);
  }

  #save(session: Session | null): void {
    this.#session.set(session);
    this.#now.set(Date.now());
    try {
      if (session) {
        this.#storage?.setItem(STORAGE_KEY, JSON.stringify(session));
      } else {
        this.#storage?.removeItem(STORAGE_KEY);
      }
    } catch {
      return;
    }
  }

  #restore(): Session | null {
    try {
      const raw = this.#storage?.getItem(STORAGE_KEY);
      const session = raw ? (JSON.parse(raw) as Session) : null;
      if (session && typeof session.token === 'string' && session.expiresAt > Date.now()) {
        return session;
      }
      this.#storage?.removeItem(STORAGE_KEY);
    } catch {
      return null;
    }
    return null;
  }
}

function sameUser(a: UserDto, b: UserDto): boolean {
  return (
    a.id === b.id && a.username === b.username && a.role === b.role && a.createdAt === b.createdAt
  );
}

function localExpiry(response: AuthResponse, receivedAt: number): number {
  const claims = decodeJwt(response.token)?.payload;
  return claims ? receivedAt + (claims.exp - claims.iat) * 1000 : Date.parse(response.expiresAt);
}
```

## `web/src/app/auth/data-access/contract.ts`

```typescript
export type * from '../../../../../contracts/auth.contract';
```

## `web/src/app/auth/data-access/jwt.ts`

```typescript
import type { TokenClaimsDto } from './contract';

export interface DecodedJwt {
  readonly parts: readonly [header: string, payload: string, signature: string];
  readonly header: Readonly<Record<string, unknown>>;
  readonly payload: TokenClaimsDto;
}

export function decodeJwt(token: string): DecodedJwt | null {
  const [header, payload, signature, ...rest] = token.split('.');
  if (header === undefined || payload === undefined || signature === undefined || rest.length > 0) {
    return null;
  }
  try {
    return {
      parts: [header, payload, signature],
      header: JSON.parse(decodeSegment(header)),
      payload: JSON.parse(decodeSegment(payload)),
    };
  } catch {
    return null;
  }
}

export function tamperPayload(
  token: string,
  change: (payload: TokenClaimsDto) => TokenClaimsDto,
): string {
  const decoded = decodeJwt(token);
  if (!decoded) {
    return token;
  }
  const [header, , signature] = decoded.parts;
  return `${header}.${encodeSegment(JSON.stringify(change(decoded.payload)))}.${signature}`;
}

function decodeSegment(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)));
}

function encodeSegment(text: string): string {
  const binary = Array.from(new TextEncoder().encode(text), (byte) =>
    String.fromCharCode(byte),
  ).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
```

## `web/src/app/auth/data-access/session-storage.ts`

```typescript
import { InjectionToken } from '@angular/core';

export const SESSION_STORAGE = new InjectionToken<Storage | null>('SESSION_STORAGE', {
  providedIn: 'root',
  factory: () => {
    try {
      return globalThis.sessionStorage ?? null;
    } catch {
      return null;
    }
  },
});
```

## `web/src/app/auth/ui/access-check/access-check.css`

```css
:host {
  display: block;
}

.panel {
  display: grid;
  gap: 0.9rem;
  padding: 1.25rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

h2 {
  margin: 0;
  font-size: 1.1rem;
}

.meta {
  margin: 0.25rem 0 0;
  color: var(--muted);
  font-size: 0.85rem;
}

ul {
  display: grid;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

li {
  display: grid;
  grid-template-columns: 1fr auto 11rem auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.75rem;
  background: var(--surface-2);
  border: 1px solid transparent;
  border-radius: 10px;
}

li[data-match='true'] {
  border-color: color-mix(in srgb, var(--success) 45%, transparent);
}

li[data-match='false'] {
  border-color: color-mix(in srgb, var(--danger) 45%, transparent);
}

.request {
  display: grid;
  gap: 0.1rem;
  min-width: 0;
}

code {
  font-family: ui-monospace, 'Cascadia Code', 'JetBrains Mono', Menlo, monospace;
  font-size: 0.85rem;
  font-weight: 600;
}

.description,
.expected {
  color: var(--muted);
  font-size: 0.82rem;
}

.result {
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}

li[data-match='true'] .result {
  color: var(--success);
}

li[data-match='false'] .result {
  color: var(--danger);
}

button.ghost {
  padding: 0.35rem 0.8rem;
}

@media (max-width: 720px) {
  li {
    grid-template-columns: 1fr auto;
  }

  .expected {
    grid-column: 1;
  }
}
```

## `web/src/app/auth/ui/access-check/access-check.html`

```html
<section class="panel" aria-labelledby="access-title">
  <header>
    <div>
      <h2 id="access-title">Перевірка доступу</h2>
      <p class="meta">Запити до сервера: він перевіряє підпис, термін дії токена і роль</p>
    </div>
    <button type="button" class="secondary" [disabled]="busy()" (click)="runAll()">
      Перевірити все
    </button>
  </header>

  <ul>
    @for (row of rows(); track row.check.id) {
      <li [attr.data-match]="row.matches">
        <div class="request">
          <code>{{ row.check.request }}</code>
          <span class="description">{{ row.check.description }}</span>
        </div>
        <span class="expected">очікується {{ row.expected }}</span>
        <span class="result" role="status">
          @if (row.state.kind === 'done') {
            {{ row.matches ? '✓' : '✗' }} {{ statusText(row.state.result) }}
          } @else if (row.state.kind === 'pending') {
            …
          } @else {
            —
          }
        </span>
        <button
          type="button"
          class="ghost"
          [disabled]="row.state.kind === 'pending'"
          (click)="run(row.check)"
        >
          Надіслати
        </button>
      </li>
    }
  </ul>
</section>
```

## `web/src/app/auth/ui/access-check/access-check.ts`

```typescript
import { Component, computed, inject, input, signal } from '@angular/core';
import { AuthApi, type ProbeResult } from '../../data-access/auth-api';
import type { Role } from '../../data-access/contract';
import { tamperPayload } from '../../data-access/jwt';

type CheckId = 'profile' | 'users' | 'missing' | 'forged';

interface Check {
  readonly id: CheckId;
  readonly request: string;
  readonly description: string;
  readonly url: string;
  readonly token: (token: string) => string | null;
  readonly expected: (role: Role) => number;
}

type CheckState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'done'; readonly result: ProbeResult };

const CHECKS: readonly Check[] = [
  {
    id: 'profile',
    request: 'GET /api/me',
    description: 'Власний профіль — доступний ролям user і admin',
    url: '/api/me',
    token: (token) => token,
    expected: () => 200,
  },
  {
    id: 'users',
    request: 'GET /api/users',
    description: 'Список усіх користувачів — лише для admin',
    url: '/api/users',
    token: (token) => token,
    expected: (role) => (role === 'admin' ? 200 : 403),
  },
  {
    id: 'missing',
    request: 'GET /api/me без токена',
    description: 'Запит без заголовка Authorization',
    url: '/api/me',
    token: () => null,
    expected: () => 401,
  },
  {
    id: 'forged',
    request: 'GET /api/users з підробкою',
    description: 'У payload змінено role на admin і продовжено exp на годину, підпис старий',
    url: '/api/users',
    token: (token) =>
      tamperPayload(token, (payload) => ({ ...payload, role: 'admin', exp: payload.exp + 3600 })),
    expected: () => 401,
  },
];

const STATUS_TEXT: Readonly<Record<number, string>> = {
  0: 'немає зв’язку',
  200: 'OK',
  401: 'Unauthorized',
  403: 'Forbidden',
};

@Component({
  selector: 'app-access-check',
  templateUrl: './access-check.html',
  styleUrl: './access-check.css',
})
export class AccessCheck {
  readonly token = input.required<string>();
  readonly role = input.required<Role>();

  readonly #api = inject(AuthApi);
  readonly #states = signal<Readonly<Partial<Record<CheckId, CheckState>>>>({});

  protected readonly rows = computed(() =>
    CHECKS.map((check) => {
      const state = this.#states()[check.id] ?? { kind: 'idle' };
      const expected = check.expected(this.role());
      return {
        check,
        state,
        expected,
        matches: state.kind === 'done' ? state.result.status === expected : null,
      };
    }),
  );
  protected readonly busy = computed(() => this.rows().some((row) => row.state.kind === 'pending'));

  protected statusText(result: ProbeResult): string {
    return [String(result.status), STATUS_TEXT[result.status] ?? '', result.code ?? '']
      .filter(Boolean)
      .join(' · ');
  }

  protected async run(check: Check): Promise<void> {
    this.#set(check.id, { kind: 'pending' });
    const result = await this.#api.probe(check.url, check.token(this.token()));
    this.#set(check.id, { kind: 'done', result });
  }

  protected async runAll(): Promise<void> {
    await Promise.all(CHECKS.map((check) => this.run(check)));
  }

  #set(id: CheckId, state: CheckState): void {
    this.#states.update((states) => ({ ...states, [id]: state }));
  }
}
```

## `web/src/app/auth/ui/admin-users/admin-users.css`

```css
:host {
  display: block;
}

.panel {
  display: grid;
  gap: 0.9rem;
  padding: 1.25rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

h2 {
  margin: 0;
  font-size: 1.1rem;
}

.meta,
.hint {
  margin: 0.25rem 0 0;
  color: var(--muted);
  font-size: 0.85rem;
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
  white-space: nowrap;
}

th {
  color: var(--muted);
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

tr[aria-busy='true'] {
  opacity: 0.6;
}

.you {
  margin-left: 0.5rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: var(--own);
  font-size: 0.75rem;
}

select {
  padding: 0.35rem 0.6rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.row-actions {
  text-align: right;
}

button.ghost {
  padding: 0.35rem 0.8rem;
}

button.danger:not(:disabled) {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 45%, transparent);
}

.empty {
  color: var(--muted);
  text-align: center;
}
```

## `web/src/app/auth/ui/admin-users/admin-users.html`

```html
<section class="panel" aria-labelledby="users-title">
  <header>
    <div>
      <h2 id="users-title">Користувачі</h2>
      <p class="meta">
        Дії адміністратора: GET /api/users, PATCH /api/users/:id/role, DELETE /api/users/:id
      </p>
    </div>
    <button type="button" class="ghost" [disabled]="list.isLoading()" (click)="list.reload()">
      Оновити
    </button>
  </header>

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
          <th scope="col">Користувач</th>
          <th scope="col">Роль</th>
          <th scope="col">Зареєстровано</th>
          <th scope="col"><span class="visually-hidden">Дії</span></th>
        </tr>
      </thead>
      <tbody>
        @for (user of users(); track user.id) {
          <tr [attr.aria-busy]="busyId() === user.id">
            <td>
              <strong>{{ user.username }}</strong>
              @if (isSelf(user)) {
                <span class="you">це ви</span>
              }
            </td>
            <td>
              <select
                #select
                [attr.aria-label]="'Роль користувача ' + user.username"
                [value]="user.role"
                [disabled]="busyId() !== null || (user.role === 'admin' && adminCount() === 1)"
                (change)="changeRole(user, select)"
              >
                @for (role of roles; track role) {
                  <option [value]="role" [selected]="role === user.role">
                    {{ roleLabels[role] }}
                  </option>
                }
              </select>
            </td>
            <td>{{ user.createdAt | date: 'dd.MM.yyyy HH:mm' }}</td>
            <td class="row-actions">
              <button
                type="button"
                class="ghost danger"
                [disabled]="busyId() !== null || isSelf(user)"
                (click)="remove(user)"
              >
                Видалити
              </button>
            </td>
          </tr>
        } @empty {
          <tr>
            <td colspan="4" class="empty">
              {{ list.isLoading() ? 'Завантаження…' : 'Користувачів немає' }}
            </td>
          </tr>
        }
      </tbody>
    </table>
  </div>

  <p class="hint">
    Роль перевіряється на сервері за базою даних, тому зміна ролі діє одразу, навіть для вже виданих
    токенів. Останнього адміністратора не можна понизити чи видалити.
  </p>
</section>
```

## `web/src/app/auth/ui/admin-users/admin-users.ts`

```typescript
import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { describeApiError } from '../../data-access/api-errors';
import { AuthApi } from '../../data-access/auth-api';
import { ROLE_LABELS } from '../../data-access/auth-rules';
import { AuthStore } from '../../data-access/auth-store';
import type { Role, UserDto, UsersResponse } from '../../data-access/contract';

@Component({
  selector: 'app-admin-users',
  imports: [DatePipe],
  templateUrl: './admin-users.html',
  styleUrl: './admin-users.css',
})
export class AdminUsers {
  protected readonly store = inject(AuthStore);
  readonly #api = inject(AuthApi);
  readonly #router = inject(Router);

  protected readonly roles: readonly Role[] = ['user', 'admin'];
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly list = httpResource<UsersResponse>(() => '/api/users');
  protected readonly busyId = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly users = computed(() => (this.list.hasValue() ? this.list.value().users : []));
  protected readonly adminCount = computed(
    () => this.users().filter((user) => user.role === 'admin').length,
  );
  protected readonly loadError = computed(() => {
    const error = this.list.error();
    return error ? describeApiError(error) : null;
  });

  protected isSelf(user: UserDto): boolean {
    return user.id === this.store.user()?.id;
  }

  protected async changeRole(user: UserDto, select: HTMLSelectElement): Promise<void> {
    const role: Role = select.value === 'admin' ? 'admin' : 'user';
    if (role === user.role) {
      return;
    }
    const changed = await this.#perform(user, async () => {
      const { user: updated } = await this.#api.changeRole(user.id, role);
      if (this.isSelf(updated)) {
        this.store.updateUser(updated);
        if (updated.role !== 'admin') {
          await this.#router.navigateByUrl('/profile');
          return;
        }
      }
      this.list.reload();
    });
    if (!changed) {
      select.value = user.role;
    }
  }

  protected async remove(user: UserDto): Promise<void> {
    if (!confirm(`Видалити користувача «${user.username}»?`)) {
      return;
    }
    await this.#perform(user, async () => {
      await this.#api.deleteUser(user.id);
      this.list.reload();
    });
  }

  async #perform(user: UserDto, action: () => Promise<void>): Promise<boolean> {
    this.busyId.set(user.id);
    this.actionError.set(null);
    try {
      await action();
      return true;
    } catch (error) {
      this.actionError.set(describeApiError(error));
      this.list.reload();
      return false;
    } finally {
      this.busyId.set(null);
    }
  }
}
```

## `web/src/app/auth/ui/auth-page/auth-page.css`

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
  margin: 0.5rem 0 1.25rem;
  color: var(--muted);
}

.tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.25rem;
  margin-bottom: 1.25rem;
  padding: 0.25rem;
  background: var(--surface-2);
  border-radius: 10px;
}

.tabs a {
  padding: 0.45rem;
  border-radius: 8px;
  color: var(--muted);
  font-weight: 600;
  text-align: center;
  text-decoration: none;
}

.tabs a[aria-current='page'] {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow);
}

.notice {
  margin: 0 0 1rem;
  padding: 0.6rem 0.85rem;
  background: var(--system);
  color: var(--system-text);
  border-radius: 10px;
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

## `web/src/app/auth/ui/auth-page/auth-page.html`

```html
<section class="card" aria-labelledby="auth-title">
  <p class="eyebrow">Лабораторна робота №2 · JWT</p>
  <h1 id="auth-title">{{ isRegister() ? 'Реєстрація' : 'Вхід' }}</h1>
  <p class="lead">
    @if (isRegister()) {
      Створіть обліковий запис. Пароль зберігається на сервері лише у вигляді хешу argon2id.
    } @else {
      Увійдіть, щоб отримати JWT-токен. Він діє обмежений час, після чого потрібно увійти знову.
    }
  </p>

  <nav class="tabs" aria-label="Режим">
    <a routerLink="/login" [attr.aria-current]="isRegister() ? null : 'page'">Вхід</a>
    <a routerLink="/register" [attr.aria-current]="isRegister() ? 'page' : null">Реєстрація</a>
  </nav>

  @if (store.notice(); as notice) {
    <p class="notice" role="status">{{ notice }}</p>
  }

  <form [formRoot]="form">
    <label for="username">Ім’я користувача</label>
    <input
      id="username"
      type="text"
      autocomplete="username"
      placeholder="Наприклад, vlad.zhukov"
      [formField]="form.username"
      [attr.aria-invalid]="usernameError() !== null"
      autofocus
    />
    @if (usernameError(); as error) {
      <p class="error" role="alert">{{ error }}</p>
    }

    <label for="password">Пароль</label>
    <input
      id="password"
      type="password"
      [attr.autocomplete]="isRegister() ? 'new-password' : 'current-password'"
      [formField]="form.password"
      [attr.aria-invalid]="passwordError() !== null"
    />
    @if (passwordError(); as error) {
      <p class="error" role="alert">{{ error }}</p>
    }

    @if (isRegister()) {
      <label for="confirmation">Повторіть пароль</label>
      <input
        id="confirmation"
        type="password"
        autocomplete="new-password"
        [formField]="form.confirmation"
        [attr.aria-invalid]="confirmationError() !== null"
      />
      @if (confirmationError(); as error) {
        <p class="error" role="alert">{{ error }}</p>
      }
      <p class="hint">
        Ім’я: {{ usernameHint }}. Пароль: {{ passwordHint }}. Перший зареєстрований користувач
        отримує роль адміністратора.
      </p>
    }

    @if (serverError(); as error) {
      <p class="error" role="alert">{{ error }}</p>
    }

    <div class="actions">
      <button type="submit" [disabled]="form().submitting()">
        {{ isRegister() ? 'Зареєструватися' : 'Увійти' }}
      </button>
      @if (form().submitting()) {
        <p class="status" role="status">Зачекайте…</p>
      }
    </div>
  </form>
</section>
```

## `web/src/app/auth/ui/auth-page/auth-page.ts`

```typescript
import { Component, computed, inject, input, signal } from '@angular/core';
import {
  applyWhen,
  form,
  FormField,
  FormRoot,
  maxLength,
  minLength,
  pattern,
  required,
  validate,
} from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { describeApiError } from '../../data-access/api-errors';
import { AuthApi } from '../../data-access/auth-api';
import {
  PASSWORD_HINT,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_HINT,
  USERNAME_PATTERN,
} from '../../data-access/auth-rules';
import { AuthStore } from '../../data-access/auth-store';

export type AuthMode = 'login' | 'register';

@Component({
  selector: 'app-auth-page',
  imports: [FormField, FormRoot, RouterLink],
  templateUrl: './auth-page.html',
  styleUrl: './auth-page.css',
})
export class AuthPage {
  readonly mode = input<AuthMode>('login');

  protected readonly store = inject(AuthStore);
  readonly #api = inject(AuthApi);
  readonly #router = inject(Router);

  protected readonly usernameHint = USERNAME_HINT;
  protected readonly passwordHint = PASSWORD_HINT;
  protected readonly isRegister = computed(() => this.mode() === 'register');
  protected readonly serverError = signal<string | null>(null);

  readonly #model = signal({ username: '', password: '', confirmation: '' });

  protected readonly form = form(
    this.#model,
    (path) => {
      required(path.username, { message: 'Введіть ім’я користувача' });
      required(path.password, { message: 'Введіть пароль' });
      applyWhen(
        path,
        () => this.isRegister(),
        (registration) => {
          pattern(registration.username, USERNAME_PATTERN, { message: USERNAME_HINT });
          minLength(registration.password, PASSWORD_MIN_LENGTH, { message: PASSWORD_HINT });
          maxLength(registration.password, PASSWORD_MAX_LENGTH, { message: PASSWORD_HINT });
          pattern(registration.password, /\S/, { message: PASSWORD_HINT });
          validate(registration.confirmation, ({ value, valueOf }) =>
            value() === valueOf(registration.password)
              ? undefined
              : { kind: 'mismatch', message: 'Паролі не збігаються' },
          );
        },
      );
    },
    {
      submission: {
        action: async (field) => {
          const { username, password } = field().value();
          this.serverError.set(null);
          try {
            const credentials = { username: username.trim(), password };
            const response = this.isRegister()
              ? await this.#api.register(credentials)
              : await this.#api.login(credentials);
            this.store.signIn(response);
            await this.#router.navigateByUrl('/profile');
          } catch (error) {
            this.serverError.set(describeApiError(error));
          }
          return undefined;
        },
      },
    },
  );

  protected readonly usernameError = computed(() => this.#firstError(this.form.username));
  protected readonly passwordError = computed(() => this.#firstError(this.form.password));
  protected readonly confirmationError = computed(() => this.#firstError(this.form.confirmation));

  #firstError(field: typeof this.form.username): string | null {
    const state = field();
    return state.touched() && state.invalid() ? (state.errors()[0]?.message ?? null) : null;
  }
}
```

## `web/src/app/auth/ui/dashboard/dashboard.css`

```css
:host {
  display: block;
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr);
  grid-template-areas:
    'profile token'
    'access access';
  gap: 1.25rem;
  align-items: start;
}

.profile {
  grid-area: profile;
}

.token {
  grid-area: token;
}

.access {
  grid-area: access;
}

.panel {
  display: grid;
  gap: 0.75rem;
  padding: 1.25rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

h2 {
  margin: 0;
  font-size: 1.1rem;
}

h3 {
  margin: 0.25rem 0 0;
  font-size: 0.95rem;
}

.meta {
  margin: -0.4rem 0 0;
  color: var(--muted);
  font-size: 0.85rem;
}

dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.45rem 1rem;
  margin: 0;
}

dt {
  color: var(--muted);
}

dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.mono {
  font-family: ui-monospace, 'Cascadia Code', 'JetBrains Mono', Menlo, monospace;
  font-size: 0.85rem;
}

.role {
  padding: 0.1rem 0.55rem;
  border-radius: 999px;
  background: var(--surface-2);
  font-size: 0.85rem;
}

.role[data-role='admin'] {
  color: var(--accent);
  font-weight: 600;
}

.actions {
  display: grid;
  gap: 0.25rem;
  margin: 0;
  padding-left: 1.2rem;
}

.link {
  color: var(--accent);
  font-weight: 600;
  text-decoration: none;
}

button.ghost {
  padding: 0.35rem 0.8rem;
}

@media (max-width: 900px) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'profile'
      'token'
      'access';
  }
}
```

## `web/src/app/auth/ui/dashboard/dashboard.html`

```html
<div class="grid">
  <section class="panel profile" aria-labelledby="profile-title">
    <header>
      <h2 id="profile-title">Профіль</h2>
      <button
        type="button"
        class="ghost"
        [disabled]="profile.isLoading()"
        (click)="profile.reload()"
      >
        Оновити
      </button>
    </header>
    <p class="meta">Дані отримано із захищеного маршруту GET /api/me</p>

    @if (loadError(); as error) {
      <p class="error" role="alert">{{ error }}</p>
    }

    @if (user(); as user) {
      <dl>
        <dt>Ім’я користувача</dt>
        <dd>{{ user.username }}</dd>
        <dt>Роль</dt>
        <dd>
          <span class="role" [attr.data-role]="user.role">{{ roleLabel() }} ({{ user.role }})</span>
        </dd>
        <dt>Ідентифікатор</dt>
        <dd class="mono">{{ user.id }}</dd>
        <dt>Зареєстровано</dt>
        <dd>{{ user.createdAt | date: 'dd.MM.yyyy HH:mm:ss' }}</dd>
      </dl>

      <h3>Доступні дії</h3>
      <ul class="actions">
        @for (action of actions(); track action) {
          <li>{{ action }}</li>
        }
      </ul>
      @if (user.role === 'admin') {
        <a class="link" routerLink="/users">Керувати користувачами →</a>
      }
    }
  </section>

  @if (store.token(); as token) {
    <app-token-panel
      class="token"
      [token]="token"
      [secondsLeft]="store.secondsLeft()"
      [lifetimeSeconds]="store.lifetimeSeconds()"
    />
    @if (user(); as user) {
      <app-access-check class="access" [token]="token" [role]="user.role" />
    }
  }
</div>
```

## `web/src/app/auth/ui/dashboard/dashboard.ts`

```typescript
import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed, effect, inject, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { describeApiError } from '../../data-access/api-errors';
import { ROLE_LABELS } from '../../data-access/auth-rules';
import { AuthStore } from '../../data-access/auth-store';
import type { ProfileResponse } from '../../data-access/contract';
import { AccessCheck } from '../access-check/access-check';
import { TokenPanel } from '../token-panel/token-panel';

const ACTIONS = {
  user: ['Переглядати власний профіль', 'Переглядати свій JWT-токен'],
  admin: [
    'Переглядати власний профіль',
    'Переглядати свій JWT-токен',
    'Переглядати список усіх користувачів',
    'Змінювати ролі користувачів',
    'Видаляти користувачів',
  ],
} as const;

@Component({
  selector: 'app-dashboard',
  imports: [AccessCheck, DatePipe, RouterLink, TokenPanel],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard {
  protected readonly store = inject(AuthStore);
  protected readonly profile = httpResource<ProfileResponse>(() => '/api/me');

  protected readonly user = computed(() =>
    this.profile.hasValue() ? this.profile.value().user : this.store.user(),
  );
  protected readonly roleLabel = computed(() => {
    const role = this.user()?.role;
    return role ? ROLE_LABELS[role] : '';
  });
  protected readonly actions = computed(() => ACTIONS[this.user()?.role ?? 'user']);
  protected readonly loadError = computed(() => {
    const error = this.profile.error();
    return error ? describeApiError(error) : null;
  });

  constructor() {
    effect(() => {
      if (this.profile.hasValue()) {
        const { user } = this.profile.value();
        untracked(() => this.store.updateUser(user));
      }
    });
  }
}
```

## `web/src/app/auth/ui/shell/shell.css`

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
  line-height: 1.2;
}

.eyebrow {
  color: var(--accent);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

nav {
  display: flex;
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

.me {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-left: auto;
}

.who {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.role,
.timer {
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--muted);
  font-size: 0.8rem;
  white-space: nowrap;
}

.role[data-role='admin'] {
  color: var(--accent);
}

.timer {
  font-variant-numeric: tabular-nums;
  color: var(--success);
}

.timer[data-state='warning'] {
  color: var(--warning);
}

main {
  width: min(100%, 72rem);
  margin: 0 auto;
  padding: 1.5rem 1.25rem 2.5rem;
}

@media (max-width: 720px) {
  .me {
    width: 100%;
    margin-left: 0;
    justify-content: space-between;
  }
}
```

## `web/src/app/auth/ui/shell/shell.html`

```html
<header class="topbar">
  <div class="brand">
    <span class="eyebrow">Лабораторна робота №2</span>
    <strong>JWT-авторизація</strong>
  </div>

  <nav aria-label="Розділи">
    <a routerLink="/profile" routerLinkActive="active" ariaCurrentWhenActive="page">Профіль</a>
    @if (store.isAdmin()) {
      <a routerLink="/users" routerLinkActive="active" ariaCurrentWhenActive="page">Користувачі</a>
    }
  </nav>

  <div class="me">
    <span
      class="timer"
      role="timer"
      [attr.data-state]="timerState()"
      title="Час до завершення дії токена"
    >
      Токен: {{ store.secondsLeft() }} с
    </span>
    <span class="who">
      <strong>{{ store.user()?.username }}</strong>
      <span class="role" [attr.data-role]="store.user()?.role">{{ roleLabel() }}</span>
    </span>
    <button type="button" class="ghost" (click)="signOut()">Вийти</button>
  </div>
</header>

<main>
  <router-outlet />
</main>
```

## `web/src/app/auth/ui/shell/shell.ts`

```typescript
import { Component, computed, effect, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ROLE_LABELS } from '../../data-access/auth-rules';
import { AuthStore } from '../../data-access/auth-store';

const WARNING_SECONDS = 15;

@Component({
  selector: 'app-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
})
export class Shell {
  protected readonly store = inject(AuthStore);
  readonly #router = inject(Router);

  protected readonly roleLabel = computed(() => {
    const role = this.store.user()?.role;
    return role ? ROLE_LABELS[role] : '';
  });
  protected readonly timerState = computed(() =>
    this.store.secondsLeft() <= WARNING_SECONDS ? 'warning' : 'ok',
  );

  constructor() {
    effect(() => {
      if (!this.store.isAuthenticated()) {
        void this.#router.navigateByUrl('/login');
      }
    });
  }

  protected signOut(): void {
    this.store.signOut();
  }
}
```

## `web/src/app/auth/ui/token-panel/token-panel.css`

```css
:host {
  display: block;
}

.panel {
  display: grid;
  gap: 0.9rem;
  padding: 1.25rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

h2 {
  margin: 0;
  font-size: 1.1rem;
}

.meta,
.note,
.countdown p {
  margin: 0;
  color: var(--muted);
  font-size: 0.85rem;
}

.countdown {
  display: grid;
  gap: 0.4rem;
}

.bar {
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
  transition: width 1s linear;
}

.label {
  margin: 0 0 0.35rem;
  font-size: 0.8rem;
  font-weight: 600;
}

.raw,
pre {
  display: block;
  margin: 0;
  padding: 0.75rem;
  background: var(--surface-2);
  border-radius: 10px;
  font-family: ui-monospace, 'Cascadia Code', 'JetBrains Mono', Menlo, monospace;
  font-size: 0.8rem;
}

.raw {
  word-break: break-all;
}

pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.decoded {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  gap: 0.9rem;
}

.part-header {
  color: #d6336c;
}

.part-payload {
  color: #7048e8;
}

.part-signature {
  color: #1c7ed6;
}

@media (prefers-color-scheme: dark) {
  .part-header {
    color: #f783ac;
  }

  .part-payload {
    color: #b197fc;
  }

  .part-signature {
    color: #74c0fc;
  }
}
```

## `web/src/app/auth/ui/token-panel/token-panel.html`

```html
<section class="panel" aria-labelledby="token-title">
  <header>
    <h2 id="token-title">JWT-токен</h2>
    <span class="meta">HS256 · діє {{ lifetimeSeconds() }} с</span>
  </header>

  <div class="countdown">
    <div
      class="bar"
      role="progressbar"
      aria-label="Залишок часу дії токена"
      [attr.aria-valuenow]="secondsLeft()"
      aria-valuemin="0"
      [attr.aria-valuemax]="lifetimeSeconds()"
    >
      <span [style.width.%]="progress()"></span>
    </div>
    <p>
      Залишилось <strong>{{ secondsLeft() }} с</strong> · видано {{ issuedAt() }} · спливає
      {{ expiresAt() }}
    </p>
  </div>

  @if (decoded(); as jwt) {
    <p class="label">Закодований токен (заголовок Authorization: Bearer …)</p>
    <code class="raw"
      ><span class="part-header">{{ jwt.parts[0] }}</span
      >.<span class="part-payload">{{ jwt.parts[1] }}</span
      >.<span class="part-signature">{{ jwt.parts[2] }}</span></code
    >

    <div class="decoded">
      <div>
        <p class="label part-header">Header</p>
        <pre>{{ headerJson() }}</pre>
      </div>
      <div>
        <p class="label part-payload">Payload</p>
        <pre>{{ payloadJson() }}</pre>
      </div>
    </div>
    <p class="note">
      Payload лише закодований у base64url, а не зашифрований: його може прочитати будь-хто. Захищає
      токен підпис — сервер перевіряє його секретним ключем і відхиляє будь-які зміни.
    </p>
  } @else {
    <p class="error">Не вдалося розібрати токен</p>
  }
</section>
```

## `web/src/app/auth/ui/token-panel/token-panel.ts`

```typescript
import { Component, computed, input } from '@angular/core';
import { decodeJwt } from '../../data-access/jwt';

const DATE_TIME = new Intl.DateTimeFormat('uk-UA', { timeStyle: 'medium', dateStyle: 'short' });

@Component({
  selector: 'app-token-panel',
  templateUrl: './token-panel.html',
  styleUrl: './token-panel.css',
})
export class TokenPanel {
  readonly token = input.required<string>();
  readonly secondsLeft = input.required<number>();
  readonly lifetimeSeconds = input.required<number>();

  protected readonly decoded = computed(() => decodeJwt(this.token()));
  protected readonly headerJson = computed(() => JSON.stringify(this.decoded()?.header, null, 2));
  protected readonly payloadJson = computed(() => JSON.stringify(this.decoded()?.payload, null, 2));
  protected readonly issuedAt = computed(() => this.#format(this.decoded()?.payload.iat));
  protected readonly expiresAt = computed(() => this.#format(this.decoded()?.payload.exp));
  protected readonly progress = computed(() => {
    const lifetime = this.lifetimeSeconds();
    return lifetime > 0 ? Math.min(100, (this.secondsLeft() / lifetime) * 100) : 0;
  });

  #format(epochSeconds: number | undefined): string {
    return epochSeconds === undefined ? '—' : DATE_TIME.format(epochSeconds * 1000);
  }
}
```

## `web/src/index.html`

```html
<!doctype html>
<html lang="uk">
  <head>
    <meta charset="utf-8" />
    <title>JWT-авторизація · Лабораторна робота №2</title>
    <base href="/" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Реєстрація, вхід і ролі користувачів на JWT-токенах" />
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
textarea,
select {
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

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

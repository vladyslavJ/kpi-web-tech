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

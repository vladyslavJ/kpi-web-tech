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

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

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

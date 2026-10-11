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

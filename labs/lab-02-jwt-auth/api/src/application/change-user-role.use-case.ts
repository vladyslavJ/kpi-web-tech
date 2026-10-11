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

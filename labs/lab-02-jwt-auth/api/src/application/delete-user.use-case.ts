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

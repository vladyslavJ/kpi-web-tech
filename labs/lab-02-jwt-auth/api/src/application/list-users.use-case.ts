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

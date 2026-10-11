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

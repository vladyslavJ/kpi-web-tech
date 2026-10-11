import { createUser, normalizeUsername, type Role } from '../domain/user.ts';
import type { Clock, IdGenerator, PasswordHasher, TokenService, UserRepository } from './ports.ts';
import { err, ok, type Result } from './result.ts';
import type { Session } from './session.ts';

export class RegisterUser {
  readonly #users: UserRepository;
  readonly #hasher: PasswordHasher;
  readonly #tokens: TokenService;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;

  constructor(deps: {
    users: UserRepository;
    hasher: PasswordHasher;
    tokens: TokenService;
    ids: IdGenerator;
    clock: Clock;
  }) {
    this.#users = deps.users;
    this.#hasher = deps.hasher;
    this.#tokens = deps.tokens;
    this.#ids = deps.ids;
    this.#clock = deps.clock;
  }

  async execute(input: { username: string; password: string }): Promise<Result<Session>> {
    const taken = err('USERNAME_TAKEN', 'This username is already taken');
    if (await this.#users.findByUsername(normalizeUsername(input.username))) {
      return taken;
    }

    const role: Role = (await this.#users.count()) === 0 ? 'admin' : 'user';
    const user = createUser({
      id: this.#ids.next(),
      username: input.username,
      passwordHash: await this.#hasher.hash(input.password),
      role,
      createdAt: this.#clock.now(),
    });
    if (!(await this.#users.add(user))) {
      return taken;
    }

    const { token, expiresAt } = await this.#tokens.issue(user);
    return ok({ user, token, expiresAt });
  }
}

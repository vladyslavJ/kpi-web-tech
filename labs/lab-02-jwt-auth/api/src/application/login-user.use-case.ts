import { normalizeUsername } from '../domain/user.ts';
import type { PasswordHasher, TokenService, UserRepository } from './ports.ts';
import { err, ok, type Result } from './result.ts';
import type { Session } from './session.ts';

export class LoginUser {
  readonly #users: UserRepository;
  readonly #hasher: PasswordHasher;
  readonly #tokens: TokenService;
  #decoyHash: Promise<string> | null = null;

  constructor(deps: { users: UserRepository; hasher: PasswordHasher; tokens: TokenService }) {
    this.#users = deps.users;
    this.#hasher = deps.hasher;
    this.#tokens = deps.tokens;
  }

  async execute(input: { username: string; password: string }): Promise<Result<Session>> {
    const user = await this.#users.findByUsername(normalizeUsername(input.username));
    const passwordMatches = await this.#hasher.verify(
      input.password,
      user?.passwordHash ?? (await this.#decoy()),
    );
    if (!user || !passwordMatches) {
      return err('INVALID_CREDENTIALS', 'Wrong username or password');
    }

    const { token, expiresAt } = await this.#tokens.issue(user);
    return ok({ user, token, expiresAt });
  }

  #decoy(): Promise<string> {
    this.#decoyHash ??= this.#hasher.hash('decoy-password-for-unknown-users');
    return this.#decoyHash;
  }
}

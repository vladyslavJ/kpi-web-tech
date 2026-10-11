import type { User } from '../domain/user.ts';
import type { AccessClaims, TokenService, UserRepository } from './ports.ts';
import { err, ok, type Result } from './result.ts';

export interface AuthContext {
  readonly user: User;
  readonly claims: AccessClaims;
}

export class AuthenticateToken {
  readonly #tokens: TokenService;
  readonly #users: UserRepository;

  constructor(deps: { tokens: TokenService; users: UserRepository }) {
    this.#tokens = deps.tokens;
    this.#users = deps.users;
  }

  async execute(token: string): Promise<Result<AuthContext>> {
    const verification = await this.#tokens.verify(token);
    if (!verification.ok) {
      return verification.reason === 'expired'
        ? err('TOKEN_EXPIRED', 'The token has expired')
        : err('INVALID_TOKEN', 'The token is invalid');
    }

    const user = await this.#users.findById(verification.claims.userId);
    if (!user) {
      return err('UNAUTHORIZED', 'The account no longer exists');
    }
    return ok({ user, claims: verification.claims });
  }
}

import { errors, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import type {
  AccessClaims,
  Clock,
  IssuedToken,
  TokenService,
  TokenVerification,
} from '../../application/ports.ts';
import { ROLES, type User, type UserId } from '../../domain/user.ts';

export interface TokenSignature {
  readonly author: string;
  readonly group: string;
  readonly variant: number;
}

export interface JoseTokenServiceOptions {
  readonly secret: string;
  readonly issuer: string;
  readonly ttlSeconds: number;
  readonly signature: TokenSignature;
  readonly clock: Clock;
}

const ALGORITHM = 'HS256';

const payloadSchema = z.object({
  sub: z.string().min(1),
  iss: z.string().min(1),
  iat: z.number().int(),
  exp: z.number().int(),
  username: z.string().min(1),
  role: z.enum(ROLES),
  author: z.string(),
  group: z.string(),
  variant: z.number().int(),
});

export class JoseTokenService implements TokenService {
  readonly #key: Uint8Array;
  readonly #issuer: string;
  readonly #ttlSeconds: number;
  readonly #signature: TokenSignature;
  readonly #clock: Clock;

  constructor(options: JoseTokenServiceOptions) {
    this.#key = new TextEncoder().encode(options.secret);
    this.#issuer = options.issuer;
    this.#ttlSeconds = options.ttlSeconds;
    this.#signature = options.signature;
    this.#clock = options.clock;
  }

  async issue(user: User): Promise<IssuedToken> {
    const issuedAt = Math.floor(this.#clock.now().getTime() / 1000);
    const expiresAt = issuedAt + this.#ttlSeconds;
    const token = await new SignJWT({
      username: user.username,
      role: user.role,
      author: this.#signature.author,
      group: this.#signature.group,
      variant: this.#signature.variant,
    })
      .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
      .setSubject(user.id)
      .setIssuer(this.#issuer)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(this.#key);
    return { token, expiresAt: new Date(expiresAt * 1000) };
  }

  async verify(token: string): Promise<TokenVerification> {
    try {
      const { payload } = await jwtVerify(token, this.#key, {
        algorithms: [ALGORITHM],
        issuer: this.#issuer,
        typ: 'JWT',
        requiredClaims: ['sub', 'iat', 'exp'],
        currentDate: this.#clock.now(),
      });
      const parsed = payloadSchema.safeParse(payload);
      if (!parsed.success) {
        return { ok: false, reason: 'invalid' };
      }
      return { ok: true, claims: toAccessClaims(parsed.data) };
    } catch (error) {
      if (error instanceof errors.JWTExpired) {
        return { ok: false, reason: 'expired' };
      }
      if (error instanceof errors.JOSEError || error instanceof TypeError) {
        return { ok: false, reason: 'invalid' };
      }
      throw error;
    }
  }
}

function toAccessClaims(payload: z.infer<typeof payloadSchema>): AccessClaims {
  return {
    userId: payload.sub as UserId,
    username: payload.username,
    role: payload.role,
    author: payload.author,
    group: payload.group,
    variant: payload.variant,
    issuer: payload.iss,
    issuedAt: new Date(payload.iat * 1000),
    expiresAt: new Date(payload.exp * 1000),
  };
}

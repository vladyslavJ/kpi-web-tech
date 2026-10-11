import type { AccessClaims } from '../../application/ports.ts';
import type { Session } from '../../application/session.ts';
import type { User } from '../../domain/user.ts';
import type { AuthResponse, TokenClaimsDto, UserDto } from './contract.ts';

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toClaimsDto(claims: AccessClaims): TokenClaimsDto {
  return {
    sub: claims.userId,
    username: claims.username,
    role: claims.role,
    author: claims.author,
    group: claims.group,
    variant: claims.variant,
    iss: claims.issuer,
    iat: toEpochSeconds(claims.issuedAt),
    exp: toEpochSeconds(claims.expiresAt),
  };
}

export function toAuthResponse(session: Session): AuthResponse {
  return {
    token: session.token,
    expiresAt: session.expiresAt.toISOString(),
    user: toUserDto(session.user),
  };
}

function toEpochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

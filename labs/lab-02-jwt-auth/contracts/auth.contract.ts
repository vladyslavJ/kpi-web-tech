export type Role = 'user' | 'admin';

export interface UserDto {
  readonly id: string;
  readonly username: string;
  readonly role: Role;
  readonly createdAt: string;
}

export interface CredentialsRequest {
  readonly username: string;
  readonly password: string;
}

export interface ChangeRoleRequest {
  readonly role: Role;
}

export interface TokenClaimsDto {
  readonly sub: string;
  readonly username: string;
  readonly role: Role;
  readonly author: string;
  readonly group: string;
  readonly variant: number;
  readonly iss: string;
  readonly iat: number;
  readonly exp: number;
}

export interface AuthResponse {
  readonly token: string;
  readonly expiresAt: string;
  readonly user: UserDto;
}

export interface ProfileResponse {
  readonly user: UserDto;
  readonly claims: TokenClaimsDto;
}

export interface UsersResponse {
  readonly users: readonly UserDto[];
}

export interface UserResponse {
  readonly user: UserDto;
}

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'USERNAME_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'UNAUTHORIZED'
  | 'TOKEN_EXPIRED'
  | 'INVALID_TOKEN'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'LAST_ADMIN'
  | 'SELF_DELETE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export interface ErrorResponse {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
  };
}

import type { Role, User, UserId } from '../domain/user.ts';

export interface UserRepository {
  findById(id: UserId): Promise<User | undefined>;
  findByUsername(username: string): Promise<User | undefined>;
  list(): Promise<readonly User[]>;
  count(): Promise<number>;
  countByRole(role: Role): Promise<number>;
  add(user: User): Promise<boolean>;
  update(user: User): Promise<void>;
  remove(id: UserId): Promise<boolean>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

export interface AccessClaims {
  readonly userId: UserId;
  readonly username: string;
  readonly role: Role;
  readonly author: string;
  readonly group: string;
  readonly variant: number;
  readonly issuer: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

export interface IssuedToken {
  readonly token: string;
  readonly expiresAt: Date;
}

export type TokenVerification =
  | { readonly ok: true; readonly claims: AccessClaims }
  | { readonly ok: false; readonly reason: 'expired' | 'invalid' };

export interface TokenService {
  issue(user: User): Promise<IssuedToken>;
  verify(token: string): Promise<TokenVerification>;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(bindings: LogContext): Logger;
}

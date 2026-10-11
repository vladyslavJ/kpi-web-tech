import { DomainError } from './domain-error.ts';

export type UserId = string & { readonly __brand: 'UserId' };

export const ROLES = ['user', 'admin'] as const;

export type Role = (typeof ROLES)[number];

export interface User {
  readonly id: UserId;
  readonly username: string;
  readonly passwordHash: string;
  readonly role: Role;
  readonly createdAt: Date;
}

export const USERNAME_PATTERN = /^[\p{L}\p{N}_.-]{3,32}$/u;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function createUser(props: {
  id: string;
  username: string;
  passwordHash: string;
  role: Role;
  createdAt: Date;
}): User {
  const username = normalizeUsername(props.username);
  if (!USERNAME_PATTERN.test(username)) {
    throw new DomainError(`Invalid username: ${JSON.stringify(props.username)}`);
  }
  if (props.passwordHash.length === 0) {
    throw new DomainError('A user must have a password hash');
  }
  const user: User = {
    id: props.id as UserId,
    username,
    passwordHash: props.passwordHash,
    role: props.role,
    createdAt: props.createdAt,
  };
  return Object.freeze(user);
}

export function withRole(user: User, role: Role): User {
  return Object.freeze({ ...user, role });
}

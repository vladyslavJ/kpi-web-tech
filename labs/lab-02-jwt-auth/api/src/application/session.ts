import type { User } from '../domain/user.ts';

export interface Session {
  readonly user: User;
  readonly token: string;
  readonly expiresAt: Date;
}

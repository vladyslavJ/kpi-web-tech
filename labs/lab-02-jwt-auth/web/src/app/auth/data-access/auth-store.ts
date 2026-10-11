import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import type { AuthResponse, UserDto } from './contract';
import { decodeJwt } from './jwt';
import { SESSION_STORAGE } from './session-storage';

const STORAGE_KEY = 'jwt-auth.session';
const TICK_MS = 1000;

export const EXPIRED_NOTICE = 'Термін дії токена минув. Увійдіть знову.';

export interface Session {
  readonly token: string;
  readonly expiresAt: number;
  readonly user: UserDto;
}

@Injectable({ providedIn: 'root' })
export class AuthStore {
  readonly #storage = inject(SESSION_STORAGE);

  readonly #session = signal<Session | null>(this.#restore());
  readonly #now = signal(Date.now());
  readonly #notice = signal<string | null>(null);

  readonly notice = this.#notice.asReadonly();
  readonly user = computed(() => this.#session()?.user ?? null);
  readonly token = computed(() => this.#session()?.token ?? null);
  readonly isAuthenticated = computed(() => this.#session() !== null);
  readonly isAdmin = computed(() => this.user()?.role === 'admin');
  readonly lifetimeSeconds = computed(() => {
    const token = this.token();
    const claims = token ? decodeJwt(token)?.payload : undefined;
    return claims ? claims.exp - claims.iat : 0;
  });
  readonly secondsLeft = computed(() => {
    const session = this.#session();
    return session ? Math.max(0, Math.ceil((session.expiresAt - this.#now()) / 1000)) : 0;
  });

  constructor() {
    effect((onCleanup) => {
      const expiresAt = this.#session()?.expiresAt;
      if (expiresAt === undefined) {
        return;
      }
      const tick = () => {
        const now = Date.now();
        this.#now.set(now);
        if (now >= expiresAt) {
          this.signOut(EXPIRED_NOTICE);
        }
      };
      tick();
      const timer = setInterval(tick, TICK_MS);
      onCleanup(() => clearInterval(timer));
    });
  }

  signIn(response: AuthResponse): void {
    this.#notice.set(null);
    this.#save({
      token: response.token,
      expiresAt: localExpiry(response, Date.now()),
      user: response.user,
    });
  }

  updateUser(user: UserDto): void {
    const session = untracked(this.#session);
    if (session && session.user.id === user.id && !sameUser(session.user, user)) {
      this.#save({ ...session, user });
    }
  }

  signOut(notice: string | null = null): void {
    this.#notice.set(notice);
    this.#save(null);
  }

  #save(session: Session | null): void {
    this.#session.set(session);
    this.#now.set(Date.now());
    try {
      if (session) {
        this.#storage?.setItem(STORAGE_KEY, JSON.stringify(session));
      } else {
        this.#storage?.removeItem(STORAGE_KEY);
      }
    } catch {
      return;
    }
  }

  #restore(): Session | null {
    try {
      const raw = this.#storage?.getItem(STORAGE_KEY);
      const session = raw ? (JSON.parse(raw) as Session) : null;
      if (session && typeof session.token === 'string' && session.expiresAt > Date.now()) {
        return session;
      }
      this.#storage?.removeItem(STORAGE_KEY);
    } catch {
      return null;
    }
    return null;
  }
}

function sameUser(a: UserDto, b: UserDto): boolean {
  return (
    a.id === b.id && a.username === b.username && a.role === b.role && a.createdAt === b.createdAt
  );
}

function localExpiry(response: AuthResponse, receivedAt: number): number {
  const claims = decodeJwt(response.token)?.payload;
  return claims ? receivedAt + (claims.exp - claims.iat) * 1000 : Date.parse(response.expiresAt);
}

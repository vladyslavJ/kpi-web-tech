import { Component, computed, inject, input, signal } from '@angular/core';
import { AuthApi, type ProbeResult } from '../../data-access/auth-api';
import type { Role } from '../../data-access/contract';
import { tamperPayload } from '../../data-access/jwt';

type CheckId = 'profile' | 'users' | 'missing' | 'forged';

interface Check {
  readonly id: CheckId;
  readonly request: string;
  readonly description: string;
  readonly url: string;
  readonly token: (token: string) => string | null;
  readonly expected: (role: Role) => number;
}

type CheckState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'done'; readonly result: ProbeResult };

const CHECKS: readonly Check[] = [
  {
    id: 'profile',
    request: 'GET /api/me',
    description: 'Власний профіль — доступний ролям user і admin',
    url: '/api/me',
    token: (token) => token,
    expected: () => 200,
  },
  {
    id: 'users',
    request: 'GET /api/users',
    description: 'Список усіх користувачів — лише для admin',
    url: '/api/users',
    token: (token) => token,
    expected: (role) => (role === 'admin' ? 200 : 403),
  },
  {
    id: 'missing',
    request: 'GET /api/me без токена',
    description: 'Запит без заголовка Authorization',
    url: '/api/me',
    token: () => null,
    expected: () => 401,
  },
  {
    id: 'forged',
    request: 'GET /api/users з підробкою',
    description: 'У payload змінено role на admin і продовжено exp на годину, підпис старий',
    url: '/api/users',
    token: (token) =>
      tamperPayload(token, (payload) => ({ ...payload, role: 'admin', exp: payload.exp + 3600 })),
    expected: () => 401,
  },
];

const STATUS_TEXT: Readonly<Record<number, string>> = {
  0: 'немає зв’язку',
  200: 'OK',
  401: 'Unauthorized',
  403: 'Forbidden',
};

@Component({
  selector: 'app-access-check',
  templateUrl: './access-check.html',
  styleUrl: './access-check.css',
})
export class AccessCheck {
  readonly token = input.required<string>();
  readonly role = input.required<Role>();

  readonly #api = inject(AuthApi);
  readonly #states = signal<Readonly<Partial<Record<CheckId, CheckState>>>>({});

  protected readonly rows = computed(() =>
    CHECKS.map((check) => {
      const state = this.#states()[check.id] ?? { kind: 'idle' };
      const expected = check.expected(this.role());
      return {
        check,
        state,
        expected,
        matches: state.kind === 'done' ? state.result.status === expected : null,
      };
    }),
  );
  protected readonly busy = computed(() => this.rows().some((row) => row.state.kind === 'pending'));

  protected statusText(result: ProbeResult): string {
    return [String(result.status), STATUS_TEXT[result.status] ?? '', result.code ?? '']
      .filter(Boolean)
      .join(' · ');
  }

  protected async run(check: Check): Promise<void> {
    this.#set(check.id, { kind: 'pending' });
    const result = await this.#api.probe(check.url, check.token(this.token()));
    this.#set(check.id, { kind: 'done', result });
  }

  protected async runAll(): Promise<void> {
    await Promise.all(CHECKS.map((check) => this.run(check)));
  }

  #set(id: CheckId, state: CheckState): void {
    this.#states.update((states) => ({ ...states, [id]: state }));
  }
}

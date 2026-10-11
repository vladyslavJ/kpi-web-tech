import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed, effect, inject, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { describeApiError } from '../../data-access/api-errors';
import { ROLE_LABELS } from '../../data-access/auth-rules';
import { AuthStore } from '../../data-access/auth-store';
import type { ProfileResponse } from '../../data-access/contract';
import { AccessCheck } from '../access-check/access-check';
import { TokenPanel } from '../token-panel/token-panel';

const ACTIONS = {
  user: ['Переглядати власний профіль', 'Переглядати свій JWT-токен'],
  admin: [
    'Переглядати власний профіль',
    'Переглядати свій JWT-токен',
    'Переглядати список усіх користувачів',
    'Змінювати ролі користувачів',
    'Видаляти користувачів',
  ],
} as const;

@Component({
  selector: 'app-dashboard',
  imports: [AccessCheck, DatePipe, RouterLink, TokenPanel],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard {
  protected readonly store = inject(AuthStore);
  protected readonly profile = httpResource<ProfileResponse>(() => '/api/me');

  protected readonly user = computed(() =>
    this.profile.hasValue() ? this.profile.value().user : this.store.user(),
  );
  protected readonly roleLabel = computed(() => {
    const role = this.user()?.role;
    return role ? ROLE_LABELS[role] : '';
  });
  protected readonly actions = computed(() => ACTIONS[this.user()?.role ?? 'user']);
  protected readonly loadError = computed(() => {
    const error = this.profile.error();
    return error ? describeApiError(error) : null;
  });

  constructor() {
    effect(() => {
      if (this.profile.hasValue()) {
        const { user } = this.profile.value();
        untracked(() => this.store.updateUser(user));
      }
    });
  }
}

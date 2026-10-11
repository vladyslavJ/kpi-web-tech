import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { describeApiError } from '../../data-access/api-errors';
import { AuthApi } from '../../data-access/auth-api';
import { ROLE_LABELS } from '../../data-access/auth-rules';
import { AuthStore } from '../../data-access/auth-store';
import type { Role, UserDto, UsersResponse } from '../../data-access/contract';

@Component({
  selector: 'app-admin-users',
  imports: [DatePipe],
  templateUrl: './admin-users.html',
  styleUrl: './admin-users.css',
})
export class AdminUsers {
  protected readonly store = inject(AuthStore);
  readonly #api = inject(AuthApi);
  readonly #router = inject(Router);

  protected readonly roles: readonly Role[] = ['user', 'admin'];
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly list = httpResource<UsersResponse>(() => '/api/users');
  protected readonly busyId = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly users = computed(() => (this.list.hasValue() ? this.list.value().users : []));
  protected readonly adminCount = computed(
    () => this.users().filter((user) => user.role === 'admin').length,
  );
  protected readonly loadError = computed(() => {
    const error = this.list.error();
    return error ? describeApiError(error) : null;
  });

  protected isSelf(user: UserDto): boolean {
    return user.id === this.store.user()?.id;
  }

  protected async changeRole(user: UserDto, select: HTMLSelectElement): Promise<void> {
    const role: Role = select.value === 'admin' ? 'admin' : 'user';
    if (role === user.role) {
      return;
    }
    const changed = await this.#perform(user, async () => {
      const { user: updated } = await this.#api.changeRole(user.id, role);
      if (this.isSelf(updated)) {
        this.store.updateUser(updated);
        if (updated.role !== 'admin') {
          await this.#router.navigateByUrl('/profile');
          return;
        }
      }
      this.list.reload();
    });
    if (!changed) {
      select.value = user.role;
    }
  }

  protected async remove(user: UserDto): Promise<void> {
    if (!confirm(`Видалити користувача «${user.username}»?`)) {
      return;
    }
    await this.#perform(user, async () => {
      await this.#api.deleteUser(user.id);
      this.list.reload();
    });
  }

  async #perform(user: UserDto, action: () => Promise<void>): Promise<boolean> {
    this.busyId.set(user.id);
    this.actionError.set(null);
    try {
      await action();
      return true;
    } catch (error) {
      this.actionError.set(describeApiError(error));
      this.list.reload();
      return false;
    } finally {
      this.busyId.set(null);
    }
  }
}

import { Component, computed, effect, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ROLE_LABELS } from '../../data-access/auth-rules';
import { AuthStore } from '../../data-access/auth-store';

const WARNING_SECONDS = 15;

@Component({
  selector: 'app-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
})
export class Shell {
  protected readonly store = inject(AuthStore);
  readonly #router = inject(Router);

  protected readonly roleLabel = computed(() => {
    const role = this.store.user()?.role;
    return role ? ROLE_LABELS[role] : '';
  });
  protected readonly timerState = computed(() =>
    this.store.secondsLeft() <= WARNING_SECONDS ? 'warning' : 'ok',
  );

  constructor() {
    effect(() => {
      if (!this.store.isAuthenticated()) {
        void this.#router.navigateByUrl('/login');
      }
    });
  }

  protected signOut(): void {
    this.store.signOut();
  }
}

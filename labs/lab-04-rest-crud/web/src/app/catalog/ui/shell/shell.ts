import { httpResource } from '@angular/common/http';
import { Component, computed, DestroyRef, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { API } from '../../data-access/catalog-api';
import type { HealthResponse } from '../../data-access/contract';

const HEALTH_CHECK_INTERVAL_MS = 15_000;

@Component({
  selector: 'app-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
})
export class Shell {
  protected readonly health = httpResource<HealthResponse>(() => API.health);
  protected readonly database = computed(() => {
    if (this.health.hasValue()) {
      return this.health.value().database === 'up' ? 'up' : 'down';
    }
    return this.health.isLoading() ? 'checking' : 'down';
  });

  constructor() {
    const timer = setInterval(() => this.health.reload(), HEALTH_CHECK_INTERVAL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}

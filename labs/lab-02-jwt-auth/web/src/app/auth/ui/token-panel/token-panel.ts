import { Component, computed, input } from '@angular/core';
import { decodeJwt } from '../../data-access/jwt';

const DATE_TIME = new Intl.DateTimeFormat('uk-UA', { timeStyle: 'medium', dateStyle: 'short' });

@Component({
  selector: 'app-token-panel',
  templateUrl: './token-panel.html',
  styleUrl: './token-panel.css',
})
export class TokenPanel {
  readonly token = input.required<string>();
  readonly secondsLeft = input.required<number>();
  readonly lifetimeSeconds = input.required<number>();

  protected readonly decoded = computed(() => decodeJwt(this.token()));
  protected readonly headerJson = computed(() => JSON.stringify(this.decoded()?.header, null, 2));
  protected readonly payloadJson = computed(() => JSON.stringify(this.decoded()?.payload, null, 2));
  protected readonly issuedAt = computed(() => this.#format(this.decoded()?.payload.iat));
  protected readonly expiresAt = computed(() => this.#format(this.decoded()?.payload.exp));
  protected readonly progress = computed(() => {
    const lifetime = this.lifetimeSeconds();
    return lifetime > 0 ? Math.min(100, (this.secondsLeft() / lifetime) * 100) : 0;
  });

  #format(epochSeconds: number | undefined): string {
    return epochSeconds === undefined ? '—' : DATE_TIME.format(epochSeconds * 1000);
  }
}

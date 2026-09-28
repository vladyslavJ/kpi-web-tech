import { Component, input } from '@angular/core';
import type { ParticipantDto } from '../../data-access/contract';

@Component({
  selector: 'app-participant-list',
  templateUrl: './participant-list.html',
  styleUrl: './participant-list.css',
})
export class ParticipantList {
  readonly participants = input.required<readonly ParticipantDto[]>();
  readonly selfId = input<string | null>(null);

  protected initial(nickname: string): string {
    return nickname.trim().charAt(0).toUpperCase();
  }

  protected hue(nickname: string): number {
    let hash = 0;
    for (const char of nickname) {
      hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360;
    }
    return hash;
  }
}

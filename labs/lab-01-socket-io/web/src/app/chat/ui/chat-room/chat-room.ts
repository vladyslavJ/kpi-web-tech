import { Component, computed, inject, signal } from '@angular/core';
import type { ConnectionStatus } from '../../data-access/chat-gateway';
import { ChatStore } from '../../data-access/chat-store';
import { MessageComposer } from '../message-composer/message-composer';
import { MessageList } from '../message-list/message-list';
import { ParticipantList } from '../participant-list/participant-list';

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  idle: 'Не підключено',
  connecting: 'Підключення…',
  connected: 'Онлайн',
  reconnecting: 'Перепідключення…',
  disconnected: 'Відключено',
};

@Component({
  selector: 'app-chat-room',
  imports: [MessageComposer, MessageList, ParticipantList],
  templateUrl: './chat-room.html',
  styleUrl: './chat-room.css',
})
export class ChatRoom {
  protected readonly store = inject(ChatStore);
  protected readonly draft = signal('');
  protected readonly statusLabel = computed(() => STATUS_LABELS[this.store.status()]);

  protected async send(): Promise<void> {
    const text = this.draft();
    const accepted = await this.store.send(text);
    if (accepted && this.draft() === text) {
      this.draft.set('');
    }
  }

  protected leave(): void {
    this.store.leave();
  }
}

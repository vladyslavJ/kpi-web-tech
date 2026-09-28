import { computed, inject, Injectable, signal } from '@angular/core';
import { describeJoinError, describeSendError } from './chat-errors';
import {
  ChatGateway,
  type ChatEvent,
  type ConnectionStatus,
  type JoinRequest,
} from './chat-gateway';
import type { MessageDto, ParticipantDto, RoomDto } from './contract';

const MAX_MESSAGES = 300;

@Injectable({ providedIn: 'root' })
export class ChatStore {
  readonly #gateway = inject(ChatGateway);

  readonly #status = signal<ConnectionStatus>('idle');
  readonly #self = signal<ParticipantDto | null>(null);
  readonly #room = signal<RoomDto | null>(null);
  readonly #participants = signal<readonly ParticipantDto[]>([]);
  readonly #messages = signal<readonly MessageDto[]>([]);
  readonly #ownIds = signal<ReadonlySet<string>>(new Set());
  readonly #joinError = signal<string | null>(null);
  readonly #sendError = signal<string | null>(null);
  readonly #sending = signal(false);

  readonly status = this.#status.asReadonly();
  readonly self = this.#self.asReadonly();
  readonly room = this.#room.asReadonly();
  readonly messages = this.#messages.asReadonly();
  readonly ownIds = this.#ownIds.asReadonly();
  readonly joinError = this.#joinError.asReadonly();
  readonly sendError = this.#sendError.asReadonly();
  readonly sending = this.#sending.asReadonly();

  readonly joined = computed(() => this.#self() !== null);
  readonly connecting = computed(() => {
    const status = this.#status();
    return !this.joined() && (status === 'connecting' || status === 'reconnecting');
  });
  readonly canSend = computed(() => this.joined() && this.#status() === 'connected');
  readonly participants = computed(() =>
    [...this.#participants()].sort((a, b) => a.nickname.localeCompare(b.nickname, 'uk')),
  );

  join(request: JoinRequest): void {
    this.#reset();
    this.#gateway.connect(request, (event) => this.#apply(event));
  }

  leave(): void {
    this.#gateway.disconnect();
    this.#reset();
  }

  async send(text: string): Promise<boolean> {
    this.#sendError.set(null);
    this.#sending.set(true);
    try {
      const result = await this.#gateway.send(text);
      if (!result.ok) {
        this.#sendError.set(describeSendError(result.code));
      }
      return result.ok;
    } finally {
      this.#sending.set(false);
    }
  }

  #apply(event: ChatEvent): void {
    switch (event.type) {
      case 'status':
        this.#status.set(event.status);
        break;
      case 'rejected':
        this.#status.set('disconnected');
        this.#joinError.set(describeJoinError(event.code));
        break;
      case 'snapshot': {
        const { self, participants, history } = event.snapshot;
        this.#self.set(self);
        this.#room.set(event.snapshot.room);
        this.#ownIds.update((ids) => new Set(ids).add(self.id));
        this.#participants.set(participants);
        this.#messages.update((current) => mergeMessages(current, history));
        this.#joinError.set(null);
        break;
      }
      case 'message':
        this.#messages.update((current) => mergeMessages(current, [event.message]));
        break;
      case 'participant-joined':
        this.#participants.update((list) => [
          ...list.filter((participant) => participant.id !== event.participant.id),
          event.participant,
        ]);
        break;
      case 'participant-left':
        this.#participants.update((list) =>
          list.filter((participant) => participant.id !== event.participant.id),
        );
        break;
      default:
        event satisfies never;
    }
  }

  #reset(): void {
    this.#status.set('idle');
    this.#self.set(null);
    this.#room.set(null);
    this.#participants.set([]);
    this.#messages.set([]);
    this.#ownIds.set(new Set());
    this.#joinError.set(null);
    this.#sendError.set(null);
    this.#sending.set(false);
  }
}

function mergeMessages(
  current: readonly MessageDto[],
  incoming: readonly MessageDto[],
): readonly MessageDto[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    byId.set(message.id, message);
  }
  return [...byId.values()]
    .sort((a, b) => (a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : 0))
    .slice(-MAX_MESSAGES);
}

import { createPresenceMessage } from '../domain/message.ts';
import type { ParticipantId } from '../domain/participant.ts';
import type { ChatNotifier, Clock, IdGenerator, MessageRepository, ParticipantRepository } from './ports.ts';

export class LeaveChat {
  readonly #participants: ParticipantRepository;
  readonly #messages: MessageRepository;
  readonly #notifier: ChatNotifier;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;

  constructor(deps: {
    participants: ParticipantRepository;
    messages: MessageRepository;
    notifier: ChatNotifier;
    ids: IdGenerator;
    clock: Clock;
  }) {
    this.#participants = deps.participants;
    this.#messages = deps.messages;
    this.#notifier = deps.notifier;
    this.#ids = deps.ids;
    this.#clock = deps.clock;
  }

  async execute(input: { participantId: ParticipantId }): Promise<void> {
    const participant = await this.#participants.remove(input.participantId);
    if (!participant) {
      return;
    }
    this.#notifier.participantLeft(participant);
    this.#notifier.messagePosted(
      createPresenceMessage({ id: this.#ids.next(), event: 'left', participant, sentAt: this.#clock.now() }),
    );

    const remaining = await this.#participants.listInRoom(participant.room.id);
    if (remaining.length === 0) {
      await this.#messages.clearRoom(participant.room.id);
    }
  }
}

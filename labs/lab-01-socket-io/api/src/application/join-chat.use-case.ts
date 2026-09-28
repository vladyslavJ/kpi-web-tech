import { createPresenceMessage, type UserMessage } from '../domain/message.ts';
import { createParticipant, type Participant } from '../domain/participant.ts';
import { createRoom, type Room } from '../domain/room.ts';
import type { ChatNotifier, Clock, IdGenerator, MessageRepository, ParticipantRepository } from './ports.ts';

export interface ChatSnapshot {
  readonly self: Participant;
  readonly room: Room;
  readonly participants: readonly Participant[];
  readonly history: readonly UserMessage[];
}

export class JoinChat {
  readonly #participants: ParticipantRepository;
  readonly #messages: MessageRepository;
  readonly #notifier: ChatNotifier;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;
  readonly #historyLimit: number;

  constructor(deps: {
    participants: ParticipantRepository;
    messages: MessageRepository;
    notifier: ChatNotifier;
    ids: IdGenerator;
    clock: Clock;
    historyLimit: number;
  }) {
    this.#participants = deps.participants;
    this.#messages = deps.messages;
    this.#notifier = deps.notifier;
    this.#ids = deps.ids;
    this.#clock = deps.clock;
    this.#historyLimit = deps.historyLimit;
  }

  async execute(input: { nickname: string; roomName: string }): Promise<ChatSnapshot> {
    const requested = createRoom(input.roomName);
    const [occupant] = await this.#participants.listInRoom(requested.id);
    const room = occupant?.room ?? requested;

    const self = createParticipant({
      id: this.#ids.next(),
      nickname: input.nickname,
      room,
      joinedAt: this.#clock.now(),
    });
    await this.#participants.add(self);
    this.#notifier.participantJoined(self);
    this.#notifier.messagePosted(
      createPresenceMessage({ id: this.#ids.next(), event: 'joined', participant: self, sentAt: this.#clock.now() }),
    );

    const [participants, history] = await Promise.all([
      this.#participants.listInRoom(room.id),
      this.#messages.recent(room.id, this.#historyLimit),
    ]);
    return { self, room, participants, history };
  }
}

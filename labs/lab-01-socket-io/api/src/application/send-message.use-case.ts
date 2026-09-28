import { createUserMessage, type MessageId } from '../domain/message.ts';
import type { ParticipantId } from '../domain/participant.ts';
import type { ChatNotifier, Clock, IdGenerator, MessageRepository, ParticipantRepository } from './ports.ts';
import { err, ok, type Result } from './result.ts';

export class SendMessage {
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

  async execute(input: { authorId: ParticipantId; text: string }): Promise<Result<{ id: MessageId }>> {
    const author = await this.#participants.get(input.authorId);
    if (!author) {
      return err('NOT_JOINED', 'Join the chat before sending messages');
    }

    const message = createUserMessage({
      id: this.#ids.next(),
      author,
      text: input.text,
      sentAt: this.#clock.now(),
    });
    await this.#messages.append(message);
    this.#notifier.messagePosted(message);
    return ok({ id: message.id });
  }
}

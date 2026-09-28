import { createSystemMessage, type SystemMessage } from '../domain/message.ts';
import type { ChatNotifier, Clock, IdGenerator } from './ports.ts';

export class BroadcastAutoMessage {
  readonly #notifier: ChatNotifier;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;
  readonly #text: string;

  constructor(deps: { notifier: ChatNotifier; ids: IdGenerator; clock: Clock; text: string }) {
    this.#notifier = deps.notifier;
    this.#ids = deps.ids;
    this.#clock = deps.clock;
    this.#text = deps.text;
  }

  execute(): SystemMessage {
    const message = createSystemMessage({
      id: this.#ids.next(),
      text: this.#text,
      sentAt: this.#clock.now(),
    });
    this.#notifier.announcementMade(message);
    return message;
  }
}

import type { MessageRepository } from '../../application/ports.ts';
import type { UserMessage } from '../../domain/message.ts';
import type { RoomId } from '../../domain/room.ts';

export class InMemoryMessageRepository implements MessageRepository {
  readonly #capacity: number;
  readonly #rooms = new Map<RoomId, UserMessage[]>();

  constructor(options: { capacity: number }) {
    this.#capacity = options.capacity;
  }

  async append(message: UserMessage): Promise<void> {
    const messages = this.#rooms.get(message.roomId) ?? [];
    messages.push(message);
    if (messages.length > this.#capacity) {
      messages.shift();
    }
    this.#rooms.set(message.roomId, messages);
  }

  async recent(roomId: RoomId, limit: number): Promise<readonly UserMessage[]> {
    const messages = this.#rooms.get(roomId) ?? [];
    return limit > 0 ? messages.slice(-limit) : [];
  }

  async clearRoom(roomId: RoomId): Promise<void> {
    this.#rooms.delete(roomId);
  }
}

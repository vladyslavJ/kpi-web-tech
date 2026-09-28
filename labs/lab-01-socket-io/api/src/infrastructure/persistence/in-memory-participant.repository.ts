import type { ParticipantRepository } from '../../application/ports.ts';
import type { Participant, ParticipantId } from '../../domain/participant.ts';
import type { RoomId } from '../../domain/room.ts';

export class InMemoryParticipantRepository implements ParticipantRepository {
  readonly #participants = new Map<ParticipantId, Participant>();

  async add(participant: Participant): Promise<void> {
    this.#participants.set(participant.id, participant);
  }

  async remove(id: ParticipantId): Promise<Participant | undefined> {
    const participant = this.#participants.get(id);
    this.#participants.delete(id);
    return participant;
  }

  async get(id: ParticipantId): Promise<Participant | undefined> {
    return this.#participants.get(id);
  }

  async listInRoom(roomId: RoomId): Promise<readonly Participant[]> {
    return [...this.#participants.values()].filter((participant) => participant.room.id === roomId);
  }
}

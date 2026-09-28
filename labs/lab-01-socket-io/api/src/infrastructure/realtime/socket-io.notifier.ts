import type { ChatNotifier } from '../../application/ports.ts';
import type { RoomMessage, SystemMessage } from '../../domain/message.ts';
import type { Participant } from '../../domain/participant.ts';
import type { RoomId } from '../../domain/room.ts';
import { toMessageDto, toParticipantDto } from './mappers.ts';
import type { ChatServer } from './socket-server.ts';

export function roomChannel(roomId: RoomId): string {
  return `room:${roomId}`;
}

export class SocketIoChatNotifier implements ChatNotifier {
  readonly #io: ChatServer;

  constructor(deps: { io: ChatServer }) {
    this.#io = deps.io;
  }

  messagePosted(message: RoomMessage): void {
    this.#io.to(roomChannel(message.roomId)).emit('message:new', toMessageDto(message));
  }

  announcementMade(message: SystemMessage): void {
    this.#io.emit('message:new', toMessageDto(message));
  }

  participantJoined(participant: Participant): void {
    this.#io.to(roomChannel(participant.room.id)).emit('participant:joined', toParticipantDto(participant));
  }

  participantLeft(participant: Participant): void {
    this.#io.to(roomChannel(participant.room.id)).emit('participant:left', toParticipantDto(participant));
  }
}

import type { ChatSnapshot } from '../../application/join-chat.use-case.ts';
import type { Result } from '../../application/result.ts';
import type { Message } from '../../domain/message.ts';
import type { Participant } from '../../domain/participant.ts';
import type { Room } from '../../domain/room.ts';
import type { Ack, ChatSnapshotDto, ErrorCode, ErrorDto, MessageDto, ParticipantDto, RoomDto } from './contract.ts';

export function toParticipantDto(participant: Participant): ParticipantDto {
  return {
    id: participant.id,
    nickname: participant.nickname,
    joinedAt: participant.joinedAt.toISOString(),
  };
}

export function toRoomDto(room: Room): RoomDto {
  return { id: room.id, name: room.name };
}

export function toMessageDto(message: Message): MessageDto {
  const base = { id: message.id, sentAt: message.sentAt.toISOString() };
  switch (message.type) {
    case 'user':
      return {
        ...base,
        type: 'user',
        text: message.text,
        author: { id: message.author.id, nickname: message.author.nickname },
      };
    case 'system':
      return { ...base, type: 'system', text: message.text };
    case 'presence':
      return {
        ...base,
        type: 'presence',
        event: message.event,
        participant: { id: message.participant.id, nickname: message.participant.nickname },
      };
  }
}

export function toSnapshotDto(snapshot: ChatSnapshot): ChatSnapshotDto {
  return {
    self: toParticipantDto(snapshot.self),
    room: toRoomDto(snapshot.room),
    participants: snapshot.participants.map(toParticipantDto),
    history: snapshot.history.map(toMessageDto),
  };
}

export function toErrorDto(code: ErrorCode, message: string): ErrorDto {
  return { code, message };
}

export function toAck<T>(result: Result<T>): Ack<T> {
  return result.ok ? { ok: true, data: result.value } : { ok: false, error: result.error };
}

export function failure(code: ErrorCode, message: string): Ack<never> {
  return { ok: false, error: toErrorDto(code, message) };
}

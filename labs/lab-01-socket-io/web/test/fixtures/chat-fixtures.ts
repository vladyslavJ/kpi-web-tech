import type {
  ChatSnapshotDto,
  MessageDto,
  ParticipantDto,
  PresenceEvent,
  RoomDto,
} from '../../src/app/chat/data-access/contract';

const T0 = '2026-09-27T12:00:00.000Z';

export const GENERAL_ROOM: RoomDto = { id: 'загальна', name: 'Загальна' };

export function participant(id: string, nickname: string): ParticipantDto {
  return { id, nickname, joinedAt: T0 };
}

export function userMessage(
  id: string,
  author: ParticipantDto,
  text: string,
  sentAt = T0,
): MessageDto {
  return { type: 'user', id, text, sentAt, author: { id: author.id, nickname: author.nickname } };
}

export function systemMessage(id: string, text: string, sentAt = T0): MessageDto {
  return { type: 'system', id, text, sentAt };
}

export function presenceMessage(
  id: string,
  event: PresenceEvent,
  who: ParticipantDto,
  sentAt = T0,
): MessageDto {
  return {
    type: 'presence',
    id,
    event,
    sentAt,
    participant: { id: who.id, nickname: who.nickname },
  };
}

export function snapshot(
  self: ParticipantDto,
  participants: readonly ParticipantDto[],
  history: readonly MessageDto[] = [],
  room: RoomDto = GENERAL_ROOM,
): ChatSnapshotDto {
  return { self, room, participants, history };
}

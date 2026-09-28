import { isValidDisplayName, normalizeDisplayName } from './display-name.ts';
import { DomainError } from './domain-error.ts';
import type { Room } from './room.ts';

export type ParticipantId = string & { readonly __brand: 'ParticipantId' };

export interface Participant {
  readonly id: ParticipantId;
  readonly nickname: string;
  readonly room: Room;
  readonly joinedAt: Date;
}

export function createParticipant(props: {
  id: string;
  nickname: string;
  room: Room;
  joinedAt: Date;
}): Participant {
  const nickname = normalizeDisplayName(props.nickname);
  if (!isValidDisplayName(nickname)) {
    throw new DomainError(`Invalid nickname: ${JSON.stringify(props.nickname)}`);
  }
  const participant: Participant = {
    id: props.id as ParticipantId,
    nickname,
    room: props.room,
    joinedAt: props.joinedAt,
  };
  return Object.freeze(participant);
}

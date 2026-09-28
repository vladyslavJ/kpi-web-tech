import { DomainError } from './domain-error.ts';
import type { Participant } from './participant.ts';
import type { RoomId } from './room.ts';

export type MessageId = string & { readonly __brand: 'MessageId' };

export const MESSAGE_MAX_LENGTH = 1000;

interface MessageBase {
  readonly id: MessageId;
  readonly sentAt: Date;
}

export interface UserMessage extends MessageBase {
  readonly type: 'user';
  readonly roomId: RoomId;
  readonly author: Pick<Participant, 'id' | 'nickname'>;
  readonly text: string;
}

export interface SystemMessage extends MessageBase {
  readonly type: 'system';
  readonly text: string;
}

export type PresenceEvent = 'joined' | 'left';

export interface PresenceMessage extends MessageBase {
  readonly type: 'presence';
  readonly roomId: RoomId;
  readonly event: PresenceEvent;
  readonly participant: Pick<Participant, 'id' | 'nickname'>;
}

export type RoomMessage = UserMessage | PresenceMessage;

export type Message = UserMessage | SystemMessage | PresenceMessage;

export function normalizeMessageText(raw: string): string {
  return raw.replace(/[\p{Cc}--[\n\t]]/gv, '').trim();
}

export function createUserMessage(props: {
  id: string;
  author: Participant;
  text: string;
  sentAt: Date;
}): UserMessage {
  const message: UserMessage = {
    type: 'user',
    id: props.id as MessageId,
    roomId: props.author.room.id,
    author: snapshotOf(props.author),
    text: validText(props.text),
    sentAt: props.sentAt,
  };
  return Object.freeze(message);
}

export function createSystemMessage(props: { id: string; text: string; sentAt: Date }): SystemMessage {
  const message: SystemMessage = {
    type: 'system',
    id: props.id as MessageId,
    text: validText(props.text),
    sentAt: props.sentAt,
  };
  return Object.freeze(message);
}

export function createPresenceMessage(props: {
  id: string;
  event: PresenceEvent;
  participant: Participant;
  sentAt: Date;
}): PresenceMessage {
  const message: PresenceMessage = {
    type: 'presence',
    id: props.id as MessageId,
    roomId: props.participant.room.id,
    event: props.event,
    participant: snapshotOf(props.participant),
    sentAt: props.sentAt,
  };
  return Object.freeze(message);
}

function snapshotOf(participant: Participant): Pick<Participant, 'id' | 'nickname'> {
  return Object.freeze({ id: participant.id, nickname: participant.nickname });
}

function validText(raw: string): string {
  const text = normalizeMessageText(raw);
  if (text.length === 0 || text.length > MESSAGE_MAX_LENGTH) {
    throw new DomainError(`Message text must be 1–${MESSAGE_MAX_LENGTH} characters long`);
  }
  return text;
}

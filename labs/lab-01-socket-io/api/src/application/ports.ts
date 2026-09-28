import type { RoomMessage, SystemMessage, UserMessage } from '../domain/message.ts';
import type { Participant, ParticipantId } from '../domain/participant.ts';
import type { RoomId } from '../domain/room.ts';

export interface ParticipantRepository {
  add(participant: Participant): Promise<void>;
  remove(id: ParticipantId): Promise<Participant | undefined>;
  get(id: ParticipantId): Promise<Participant | undefined>;
  listInRoom(roomId: RoomId): Promise<readonly Participant[]>;
}

export interface MessageRepository {
  append(message: UserMessage): Promise<void>;
  recent(roomId: RoomId, limit: number): Promise<readonly UserMessage[]>;
  clearRoom(roomId: RoomId): Promise<void>;
}

export interface ChatNotifier {
  messagePosted(message: RoomMessage): void;
  announcementMade(message: SystemMessage): void;
  participantJoined(participant: Participant): void;
  participantLeft(participant: Participant): void;
}

export interface Scheduler {
  every(intervalMs: number, task: () => void): () => void;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(bindings: LogContext): Logger;
}

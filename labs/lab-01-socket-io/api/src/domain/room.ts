import { isValidDisplayName, normalizeDisplayName } from './display-name.ts';
import { DomainError } from './domain-error.ts';

export type RoomId = string & { readonly __brand: 'RoomId' };

export interface Room {
  readonly id: RoomId;
  readonly name: string;
}

export function createRoom(rawName: string): Room {
  const name = normalizeDisplayName(rawName);
  if (!isValidDisplayName(name)) {
    throw new DomainError(`Invalid room name: ${JSON.stringify(rawName)}`);
  }
  const room: Room = { id: roomIdOf(name), name };
  return Object.freeze(room);
}

export function roomIdOf(rawName: string): RoomId {
  return normalizeDisplayName(rawName).toLowerCase() as RoomId;
}

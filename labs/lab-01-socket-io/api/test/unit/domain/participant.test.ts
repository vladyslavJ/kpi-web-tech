import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DomainError } from '../../../src/domain/domain-error.ts';
import { createParticipant } from '../../../src/domain/participant.ts';
import { createRoom } from '../../../src/domain/room.ts';

const joinedAt = new Date('2026-09-27T12:00:00.000Z');
const room = createRoom('Загальна');

describe('createParticipant', () => {
  it('accepts nicknames in any alphabet, normalizes whitespace and belongs to a room', () => {
    const participant = createParticipant({ id: 'p-1', nickname: '  Владислав   Ж.  ', room, joinedAt });

    assert.equal(participant.nickname, 'Владислав Ж.');
    assert.equal(participant.id, 'p-1');
    assert.equal(participant.room, room);
    assert.ok(Object.isFrozen(participant));
  });

  for (const nickname of ['a', '   ', 'x'.repeat(33), '<script>', 'smile🙂']) {
    it(`rejects ${JSON.stringify(nickname)}`, () => {
      assert.throws(() => createParticipant({ id: 'p-1', nickname, room, joinedAt }), DomainError);
    });
  }
});

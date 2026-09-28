import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DomainError } from '../../../src/domain/domain-error.ts';
import { createRoom, roomIdOf } from '../../../src/domain/room.ts';

describe('createRoom', () => {
  it('keeps the typed name for display and derives a case-insensitive id', () => {
    const room = createRoom('  Лаба   1  ');

    assert.equal(room.name, 'Лаба 1');
    assert.equal(room.id, 'лаба 1');
    assert.ok(Object.isFrozen(room));
  });

  it('gives the same id to names that differ only in case and spacing', () => {
    assert.equal(roomIdOf('ЛАБА 1'), roomIdOf(' лаба   1 '));
  });

  for (const name of ['x', '   ', 'y'.repeat(33), '<room>']) {
    it(`rejects ${JSON.stringify(name)}`, () => {
      assert.throws(() => createRoom(name), DomainError);
    });
  }
});

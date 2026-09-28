import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DomainError } from '../../../src/domain/domain-error.ts';
import {
  createPresenceMessage,
  createSystemMessage,
  createUserMessage,
  MESSAGE_MAX_LENGTH,
  normalizeMessageText,
} from '../../../src/domain/message.ts';
import { createParticipant } from '../../../src/domain/participant.ts';
import { createRoom } from '../../../src/domain/room.ts';

const sentAt = new Date('2026-09-27T12:00:00.000Z');
const author = createParticipant({ id: 'p-1', nickname: 'Alice', room: createRoom('Лаба'), joinedAt: sentAt });

describe('normalizeMessageText', () => {
  it('removes control characters but keeps line breaks and tabs', () => {
    assert.equal(normalizeMessageText('  a\u0007b\u0000\nc\td  '), 'ab\nc\td');
  });
});

describe('createUserMessage', () => {
  it('stores normalized text, the author room and an immutable snapshot of the author', () => {
    const message = createUserMessage({ id: 'm-1', author, text: '  hi  ', sentAt });

    assert.equal(message.type, 'user');
    assert.equal(message.text, 'hi');
    assert.equal(message.roomId, 'лаба');
    assert.deepEqual(message.author, { id: 'p-1', nickname: 'Alice' });
    assert.ok(Object.isFrozen(message));
    assert.ok(Object.isFrozen(message.author));
  });

  it('accepts text of exactly the maximum length', () => {
    const text = 'x'.repeat(MESSAGE_MAX_LENGTH);
    assert.equal(createUserMessage({ id: 'm-1', author, text, sentAt }).text, text);
  });

  it('rejects text that is empty after normalization or too long', () => {
    for (const text of ['', ' \u0007 ', 'x'.repeat(MESSAGE_MAX_LENGTH + 1)]) {
      assert.throws(() => createUserMessage({ id: 'm-1', author, text, sentAt }), DomainError);
    }
  });
});

describe('createSystemMessage', () => {
  it('creates a message without an author', () => {
    const message = createSystemMessage({ id: 'm-1', text: 'Server says hi', sentAt });

    assert.equal(message.type, 'system');
    assert.equal('author' in message, false);
  });
});

describe('createPresenceMessage', () => {
  it('records who joined or left which room, without any text', () => {
    const message = createPresenceMessage({ id: 'm-1', event: 'left', participant: author, sentAt });

    assert.equal(message.type, 'presence');
    assert.equal(message.event, 'left');
    assert.equal(message.roomId, author.room.id);
    assert.deepEqual(message.participant, { id: 'p-1', nickname: 'Alice' });
    assert.equal('text' in message, false);
    assert.ok(Object.isFrozen(message));
  });
});

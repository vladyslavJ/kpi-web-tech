import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createUserMessage } from '../../../../src/domain/message.ts';
import { createParticipant } from '../../../../src/domain/participant.ts';
import { createRoom, type RoomId } from '../../../../src/domain/room.ts';
import { InMemoryMessageRepository } from '../../../../src/infrastructure/persistence/in-memory-message.repository.ts';

const inRoom = (name: string) => createParticipant({ id: name, nickname: 'Alice', room: createRoom(name), joinedAt: new Date(0) });
const alpha = inRoom('Alpha');
const beta = inRoom('Beta');
const message = (text: string, author = alpha) => createUserMessage({ id: text, author, text, sentAt: new Date(0) });
const texts = async (repository: InMemoryMessageRepository, roomId: RoomId, limit = 10) =>
  (await repository.recent(roomId, limit)).map((item) => item.text);

describe('InMemoryMessageRepository', () => {
  it('keeps only the most recent messages of a room, oldest first', async () => {
    const repository = new InMemoryMessageRepository({ capacity: 3 });
    for (const text of ['1', '2', '3', '4', '5']) {
      await repository.append(message(text));
    }

    assert.deepEqual(await texts(repository, alpha.room.id), ['3', '4', '5'], 'capacity bounds memory');
    assert.deepEqual(await texts(repository, alpha.room.id, 2), ['4', '5']);
    assert.deepEqual(await texts(repository, alpha.room.id, 0), []);
  });

  it('keeps rooms apart and forgets a cleared room', async () => {
    const repository = new InMemoryMessageRepository({ capacity: 3 });
    await repository.append(message('in alpha'));
    await repository.append(message('in beta', beta));

    assert.deepEqual(await texts(repository, alpha.room.id), ['in alpha']);
    assert.deepEqual(await texts(repository, beta.room.id), ['in beta']);

    await repository.clearRoom(alpha.room.id);
    assert.deepEqual(await texts(repository, alpha.room.id), []);
    assert.deepEqual(await texts(repository, beta.room.id), ['in beta']);
  });
});

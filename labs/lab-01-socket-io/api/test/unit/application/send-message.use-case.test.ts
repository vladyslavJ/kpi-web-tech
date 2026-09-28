import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { FakeClock, SequentialIds } from '../../fakes/system.ts';
import { SpyNotifier } from '../../fakes/spy.notifier.ts';
import { createParticipant, type Participant, type ParticipantId } from '../../../src/domain/participant.ts';
import { createRoom } from '../../../src/domain/room.ts';
import { InMemoryMessageRepository } from '../../../src/infrastructure/persistence/in-memory-message.repository.ts';
import { InMemoryParticipantRepository } from '../../../src/infrastructure/persistence/in-memory-participant.repository.ts';
import { SendMessage } from '../../../src/application/send-message.use-case.ts';

describe('SendMessage', () => {
  let clock: FakeClock;
  let messages: InMemoryMessageRepository;
  let notifier: SpyNotifier;
  let author: Participant;
  let sendMessage: SendMessage;

  beforeEach(async () => {
    clock = new FakeClock();
    messages = new InMemoryMessageRepository({ capacity: 10 });
    notifier = new SpyNotifier();
    const participants = new InMemoryParticipantRepository();
    author = createParticipant({ id: 'p-1', nickname: 'Alice', room: createRoom('Лаба'), joinedAt: clock.now() });
    await participants.add(author);
    sendMessage = new SendMessage({ participants, messages, notifier, ids: new SequentialIds('m'), clock });
  });

  it('refuses authors who are not in the chat', async () => {
    const result = await sendMessage.execute({ authorId: 'ghost' as ParticipantId, text: 'boo' });

    assert.equal(result.ok, false);
    assert.equal(result.ok ? undefined : result.error.code, 'NOT_JOINED');
    assert.equal(notifier.posted.length, 0);
    assert.deepEqual(await messages.recent(author.room.id, 10), []);
  });

  it('stores the message in the author room, delivers it and returns its id', async () => {
    clock.advance(1500);
    const result = await sendMessage.execute({ authorId: author.id, text: 'Привіт' });

    assert.ok(result.ok);
    assert.equal(result.value.id, 'm-1');

    const [posted] = notifier.posted;
    assert.ok(posted?.type === 'user');
    assert.equal(posted.text, 'Привіт');
    assert.deepEqual(posted.author, { id: 'p-1', nickname: 'Alice' });
    assert.equal(posted.roomId, author.room.id);
    assert.deepEqual(posted.sentAt, clock.now(), 'the server clock stamps the message');
    assert.deepEqual(await messages.recent(author.room.id, 10), [posted]);
  });
});

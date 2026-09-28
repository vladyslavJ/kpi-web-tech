import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { FakeClock, SequentialIds } from '../../fakes/system.ts';
import { SpyNotifier } from '../../fakes/spy.notifier.ts';
import { JoinChat } from '../../../src/application/join-chat.use-case.ts';
import { createUserMessage } from '../../../src/domain/message.ts';
import { createParticipant } from '../../../src/domain/participant.ts';
import { createRoom } from '../../../src/domain/room.ts';
import { InMemoryMessageRepository } from '../../../src/infrastructure/persistence/in-memory-message.repository.ts';
import { InMemoryParticipantRepository } from '../../../src/infrastructure/persistence/in-memory-participant.repository.ts';

describe('JoinChat', () => {
  let clock: FakeClock;
  let participants: InMemoryParticipantRepository;
  let messages: InMemoryMessageRepository;
  let notifier: SpyNotifier;
  let joinChat: JoinChat;

  beforeEach(() => {
    clock = new FakeClock();
    participants = new InMemoryParticipantRepository();
    messages = new InMemoryMessageRepository({ capacity: 10 });
    notifier = new SpyNotifier();
    joinChat = new JoinChat({ participants, messages, notifier, ids: new SequentialIds('p'), clock, historyLimit: 2 });
  });

  async function seed(nickname: string, roomName: string, texts: readonly string[] = []) {
    const participant = createParticipant({ id: nickname, nickname, room: createRoom(roomName), joinedAt: clock.now() });
    await participants.add(participant);
    for (const text of texts) {
      await messages.append(createUserMessage({ id: `${nickname}-${text}`, author: participant, text, sentAt: clock.now() }));
    }
    return participant;
  }

  it('registers the participant in the room, notifies it and returns that room only', async () => {
    await seed('Existing', 'Лаба', ['one', 'two', 'three']);
    await seed('Stranger', 'Інша', ['elsewhere']);

    const snapshot = await joinChat.execute({ nickname: 'Newbie', roomName: 'Лаба' });

    assert.equal(snapshot.self.nickname, 'Newbie');
    assert.equal(snapshot.self.id, 'p-1');
    assert.equal(snapshot.room.name, 'Лаба');
    assert.deepEqual(
      snapshot.participants.map((participant) => participant.nickname),
      ['Existing', 'Newbie'],
      'people from other rooms are not listed',
    );
    assert.deepEqual(
      snapshot.history.map((message) => message.text),
      ['two', 'three'],
      'history of this room only, limited and oldest first',
    );
    assert.deepEqual(notifier.joined, [snapshot.self]);

    const [notice] = notifier.posted;
    assert.ok(notice?.type === 'presence');
    assert.equal(notice.event, 'joined');
    assert.equal(notice.participant.id, snapshot.self.id);
    assert.equal(notice.roomId, snapshot.room.id);
    assert.deepEqual(notice.sentAt, clock.now());
  });

  it('puts differently typed names into the existing room and keeps its original name', async () => {
    const creator = await seed('Creator', 'Лаба 1');

    const snapshot = await joinChat.execute({ nickname: 'Late', roomName: '  лаба   1 ' });

    assert.equal(snapshot.room.id, creator.room.id);
    assert.equal(snapshot.room.name, 'Лаба 1');
    assert.equal(snapshot.participants.length, 2);
  });

  it('creates a new room when nobody is in it yet', async () => {
    const snapshot = await joinChat.execute({ nickname: 'First', roomName: 'Нова кімната' });

    assert.equal(snapshot.room.name, 'Нова кімната');
    assert.deepEqual(snapshot.participants, [snapshot.self]);
    assert.deepEqual(snapshot.history, []);
  });
});

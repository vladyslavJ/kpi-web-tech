import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { SpyNotifier } from '../../fakes/spy.notifier.ts';
import { FakeClock, SequentialIds } from '../../fakes/system.ts';
import { LeaveChat } from '../../../src/application/leave-chat.use-case.ts';
import { createUserMessage } from '../../../src/domain/message.ts';
import { createParticipant, type Participant } from '../../../src/domain/participant.ts';
import { createRoom } from '../../../src/domain/room.ts';
import { InMemoryMessageRepository } from '../../../src/infrastructure/persistence/in-memory-message.repository.ts';
import { InMemoryParticipantRepository } from '../../../src/infrastructure/persistence/in-memory-participant.repository.ts';

describe('LeaveChat', () => {
  const room = createRoom('Лаба');
  let participants: InMemoryParticipantRepository;
  let messages: InMemoryMessageRepository;
  let notifier: SpyNotifier;
  let leaveChat: LeaveChat;

  beforeEach(() => {
    participants = new InMemoryParticipantRepository();
    messages = new InMemoryMessageRepository({ capacity: 10 });
    notifier = new SpyNotifier();
    leaveChat = new LeaveChat({ participants, messages, notifier, ids: new SequentialIds('m'), clock: new FakeClock() });
  });

  async function enter(nickname: string): Promise<Participant> {
    const participant = createParticipant({ id: nickname, nickname, room, joinedAt: new Date(0) });
    await participants.add(participant);
    await messages.append(createUserMessage({ id: `${nickname}-msg`, author: participant, text: 'hi', sentAt: new Date(0) }));
    return participant;
  }

  it('removes the participant and tells the room exactly once', async () => {
    const alice = await enter('Alice');

    await leaveChat.execute({ participantId: alice.id });
    await leaveChat.execute({ participantId: alice.id });

    assert.deepEqual(await participants.listInRoom(room.id), []);
    assert.deepEqual(notifier.left, [alice]);
    assert.equal(notifier.posted.length, 1);
    const [notice] = notifier.posted;
    assert.ok(notice?.type === 'presence');
    assert.equal(notice.event, 'left');
    assert.deepEqual(notice.participant, { id: alice.id, nickname: 'Alice' });
  });

  it('keeps the history while someone is still in the room and drops it once the room is empty', async () => {
    const alice = await enter('Alice');
    const bob = await enter('Bob');

    await leaveChat.execute({ participantId: alice.id });
    assert.equal((await messages.recent(room.id, 10)).length, 2);

    await leaveChat.execute({ participantId: bob.id });
    assert.deepEqual(await messages.recent(room.id, 10), []);
  });
});

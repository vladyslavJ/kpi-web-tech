import { TestBed } from '@angular/core/testing';
import { participant, snapshot, systemMessage, userMessage } from '../../../fixtures/chat-fixtures';
import { FakeChatGateway } from '../../../fakes/fake-chat-gateway';
import { ChatGateway } from '../../../../src/app/chat/data-access/chat-gateway';
import { ChatStore } from '../../../../src/app/chat/data-access/chat-store';

describe('ChatStore', () => {
  const alice = participant('p-alice', 'Аліса');
  const bohdan = participant('p-bohdan', 'Богдан');

  let store: ChatStore;
  let gateway: FakeChatGateway;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: ChatGateway, useClass: FakeChatGateway }],
    });
    store = TestBed.inject(ChatStore);
    gateway = TestBed.inject(ChatGateway) as FakeChatGateway;
  });

  function joinAsAlice(): void {
    store.join({ nickname: 'Аліса', room: 'Загальна' });
    gateway.emit({ type: 'status', status: 'connected' });
    gateway.emit({ type: 'snapshot', snapshot: snapshot(alice, [alice]) });
  }

  it('is "connecting" until the server sends the snapshot', () => {
    store.join({ nickname: 'Аліса', room: 'Загальна' });
    gateway.emit({ type: 'status', status: 'connecting' });

    expect(gateway.request).toEqual({ nickname: 'Аліса', room: 'Загальна' });
    expect(store.connecting()).toBe(true);
    expect(store.joined()).toBe(false);

    gateway.emit({ type: 'status', status: 'connected' });
    gateway.emit({ type: 'snapshot', snapshot: snapshot(alice, [bohdan, alice]) });

    expect(store.joined()).toBe(true);
    expect(store.canSend()).toBe(true);
    expect(store.participants().map((p) => p.nickname)).toEqual(['Аліса', 'Богдан']);
  });

  it('exposes the room the server put us in and forgets it on leave', () => {
    store.join({ nickname: 'Аліса', room: 'лаба 1' });
    gateway.emit({
      type: 'snapshot',
      snapshot: snapshot(alice, [alice], [], { id: 'лаба 1', name: 'Лаба 1' }),
    });

    expect(store.room()).toEqual({ id: 'лаба 1', name: 'Лаба 1' });

    store.leave();
    expect(store.room()).toBeNull();
  });

  it('merges messages without duplicates, in chronological order', () => {
    store.join({ nickname: 'Аліса', room: 'Загальна' });
    const first = userMessage('m-1', bohdan, 'перше', '2026-09-27T12:00:01.000Z');
    const second = userMessage('m-2', bohdan, 'друге', '2026-09-27T12:00:02.000Z');

    gateway.emit({ type: 'message', message: second });
    gateway.emit({ type: 'snapshot', snapshot: snapshot(alice, [alice, bohdan], [first, second]) });

    expect(store.messages().map((m) => m.id)).toEqual(['m-1', 'm-2']);
  });

  it('keeps the list of online participants up to date', () => {
    joinAsAlice();

    gateway.emit({ type: 'participant-joined', participant: bohdan });
    gateway.emit({ type: 'participant-joined', participant: bohdan });
    expect(store.participants()).toHaveLength(2);

    gateway.emit({ type: 'participant-left', participant: bohdan });
    expect(store.participants().map((p) => p.id)).toEqual(['p-alice']);
  });

  it('still treats messages as own after a reconnect gave this tab a new id', () => {
    joinAsAlice();
    const beforeDrop = userMessage('m-1', alice, 'до обриву');
    gateway.emit({ type: 'message', message: beforeDrop });

    const aliceAgain = participant('p-alice-2', 'Аліса');
    gateway.emit({ type: 'snapshot', snapshot: snapshot(aliceAgain, [aliceAgain], [beforeDrop]) });

    expect(store.self()?.id).toBe('p-alice-2');
    expect([...store.ownIds()]).toEqual(['p-alice', 'p-alice-2']);
  });

  it('explains a rejected nickname in Ukrainian', () => {
    store.join({ nickname: 'x', room: 'Загальна' });
    gateway.emit({ type: 'rejected', code: 'VALIDATION_ERROR' });

    expect(store.joined()).toBe(false);
    expect(store.connecting()).toBe(false);
    expect(store.joinError()).toContain('нікнейм');
  });

  it('reports a failed send and clears the error on the next success', async () => {
    joinAsAlice();

    gateway.nextSendResult = { ok: false, code: 'RATE_LIMITED' };
    expect(await store.send('спам')).toBe(false);
    expect(store.sendError()).toContain('Забагато повідомлень');

    gateway.nextSendResult = { ok: true, id: 'm-9' };
    expect(await store.send('нормально')).toBe(true);
    expect(store.sendError()).toBeNull();
    expect(gateway.sent).toEqual(['спам', 'нормально']);
  });

  it('forgets everything on leave and ignores the old connection', () => {
    joinAsAlice();
    gateway.emit({ type: 'message', message: systemMessage('auto-1', 'auto') });

    store.leave();
    gateway.emit({ type: 'message', message: systemMessage('auto-2', 'too late') });

    expect(store.joined()).toBe(false);
    expect(store.messages()).toEqual([]);
    expect(gateway.request).toBeNull();
  });
});

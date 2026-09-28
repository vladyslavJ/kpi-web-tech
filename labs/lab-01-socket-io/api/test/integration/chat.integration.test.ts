import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { io, type Socket } from 'socket.io-client';
import { createApp, type App } from '../../src/app.ts';
import type { AppConfig } from '../../src/config.ts';
import type {
  ChatSnapshotDto,
  ClientToServerEvents,
  ErrorDto,
  SendMessagePayload,
  ServerToClientEvents,
} from '../../src/infrastructure/realtime/contract.ts';
import { ManualScheduler } from '../fakes/manual.scheduler.ts';
import { silentLogger } from '../fakes/system.ts';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type ServerEvent = keyof ServerToClientEvents;
type EventArg<E extends ServerEvent> = Parameters<ServerToClientEvents[E]>[0];

const DEFAULT_ROOM = 'Загальна';

const AUTO_TEXT = 'Автоматичне повідомлення від ст. Жукова Владислава Віталійовича гр. ІС-33 Варіант 11';

const config: AppConfig = {
  environment: 'test',
  port: 0,
  corsOrigins: ['http://localhost:4200'],
  historyLimit: 50,
  maxPayloadBytes: 16 * 1024,
  autoMessage: { text: AUTO_TEXT, intervalMs: 21_000 },
  rateLimit: { capacity: 3, refillPerSecond: 0.001 },
  logLevel: 'error',
  logFormat: 'json',
  staticDir: undefined,
};

describe('chat server over real sockets', { timeout: 10_000 }, () => {
  const scheduler = new ManualScheduler();
  const sockets: ClientSocket[] = [];
  let app: App;
  let baseUrl: string;

  before(async () => {
    app = createApp(config, { scheduler, logger: silentLogger });
    const { port } = await app.start();
    baseUrl = `http://localhost:${port}`;
  });

  after(async () => {
    for (const socket of sockets) {
      socket.disconnect();
    }
    await app.stop();
  });

  function connect(nickname: string, room = DEFAULT_ROOM): ClientSocket {
    const socket: ClientSocket = io(baseUrl, {
      auth: { nickname, room },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    return socket;
  }

  function waitFor<E extends ServerEvent>(
    socket: ClientSocket,
    event: E,
    predicate: (payload: EventArg<E>) => boolean = () => true,
  ): Promise<EventArg<E>> {
    return new Promise((resolve, reject) => {
      const listener = (payload: EventArg<E>): void => {
        if (predicate(payload)) {
          clearTimeout(timer);
          socket.off(event, listener as never);
          resolve(payload);
        }
      };
      const timer = setTimeout(() => {
        socket.off(event, listener as never);
        reject(new Error(`Timed out waiting for "${event}"`));
      }, 2000);
      socket.on(event, listener as never);
    });
  }

  async function join(
    nickname: string,
    room = DEFAULT_ROOM,
  ): Promise<{ socket: ClientSocket; snapshot: ChatSnapshotDto }> {
    const socket = connect(nickname, room);
    const snapshot = await waitFor(socket, 'chat:snapshot');
    return { socket, snapshot };
  }

  function send(socket: ClientSocket, payload: SendMessagePayload) {
    return socket.timeout(2000).emitWithAck('message:send', payload);
  }

  function collect<E extends ServerEvent>(socket: ClientSocket, event: E): EventArg<E>[] {
    const received: EventArg<E>[] = [];
    socket.on(event, ((payload: EventArg<E>) => received.push(payload)) as never);
    return received;
  }

  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('serves a health check', async () => {
    const response = await fetch(`${baseUrl}/health`);
    const body = (await response.json()) as { status: string };

    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
  });

  it('rejects an invalid nickname or room name during the handshake', async () => {
    for (const [nickname, room] of [['x', DEFAULT_ROOM], ['Нормальний', 'x']] as const) {
      const socket = connect(nickname, room);
      const error = await new Promise<Error & { data?: ErrorDto }>((resolve) => {
        socket.once('connect_error', resolve);
      });

      assert.equal(error.message, 'VALIDATION_ERROR');
      assert.equal(error.data?.code, 'VALIDATION_ERROR');
    }
  });

  it('puts people who type the same room name into one room, whatever the case', async () => {
    const creator = await join('Творець', 'Спільна Кімната');
    const announced = waitFor(creator.socket, 'participant:joined', (p) => p.nickname === 'Гість');
    const guest = await join('Гість', '  спільна   кімната ');

    assert.equal(guest.snapshot.room.id, creator.snapshot.room.id);
    assert.equal(guest.snapshot.room.name, 'Спільна Кімната', 'the creator\'s spelling is kept');
    assert.ok(guest.snapshot.participants.some((p) => p.id === creator.snapshot.self.id));
    assert.equal((await announced).id, guest.snapshot.self.id);
  });

  it('keeps messages and presence inside their room', async () => {
    const author = await join('Автор А', 'Кімната А');
    const neighbour = await join('Сусід А', 'Кімната А');
    const outsider = await join('Чужий', 'Кімната Б');
    const outsiderInbox = collect(outsider.socket, 'message:new');
    const outsiderJoins = collect(outsider.socket, 'participant:joined');

    const received = waitFor(neighbour.socket, 'message:new', (m) => m.type === 'user' && m.text === 'тільки для А');
    const ack = await send(author.socket, { text: 'тільки для А' });
    assert.ok(ack.ok);
    assert.equal((await received).id, ack.data.id);

    await join('Ще один А', 'Кімната А');
    await pause(200);
    assert.deepEqual(outsiderInbox, [], 'room Б got nothing from room А');
    assert.deepEqual(outsiderJoins, []);
    assert.deepEqual(outsider.snapshot.participants.map((p) => p.nickname), ['Чужий']);
  });

  it('announces arrivals and departures inside the room but keeps them out of the history', async () => {
    const host = await join('Господар', 'Вітальня');
    const outsider = await join('Сторонній', 'Кухня');
    const outsiderInbox = collect(outsider.socket, 'message:new');

    const arrived = waitFor(
      host.socket,
      'message:new',
      (m) => m.type === 'presence' && m.event === 'joined' && m.participant.nickname === 'Гостя',
    );
    const guest = await join('Гостя', 'Вітальня');
    const arrival = await arrived;
    assert.ok(arrival.type === 'presence');
    assert.equal(arrival.participant.id, guest.snapshot.self.id);

    const departed = waitFor(
      host.socket,
      'message:new',
      (m) => m.type === 'presence' && m.event === 'left' && m.participant.id === guest.snapshot.self.id,
    );
    guest.socket.disconnect();
    await departed;

    const later = await join('Пізніше', 'Вітальня');
    assert.ok(later.snapshot.history.every((m) => m.type === 'user'), 'history holds the conversation only');
    assert.deepEqual(
      outsiderInbox.filter((m) => m.type === 'presence'),
      [],
      'other rooms are not told',
    );
  });

    it('forgets the history of a room once everybody has left it', async () => {
    const lonely = await join('Самотній', 'Тимчасова');
    assert.ok((await send(lonely.socket, { text: 'зникне' })).ok);
    lonely.socket.disconnect();
    await pause(200);

    const next = await join('Наступний', 'Тимчасова');
    assert.deepEqual(next.snapshot.history, []);
  });

  it('sends a snapshot to the newcomer and announces them to the others', async () => {
    const alice = await join('Аліса');
    const announced = waitFor(alice.socket, 'participant:joined', (p) => p.nickname === 'Богдан');
    const bob = await join('Богдан');

    assert.equal((await announced).id, bob.snapshot.self.id);
    assert.equal(bob.snapshot.self.nickname, 'Богдан');
    assert.ok(bob.snapshot.participants.some((p) => p.id === alice.snapshot.self.id));
  });

  it('delivers a message to every participant and acknowledges the sender', async () => {
    const sender = await join('Відправник');
    const receiver = await join('Отримувач');
    const received = waitFor(receiver.socket, 'message:new', (m) => m.type === 'user' && m.text === 'Привіт!');
    const echoed = waitFor(sender.socket, 'message:new', (m) => m.type === 'user' && m.text === 'Привіт!');

    const ack = await send(sender.socket, { text: '   Привіт!   ' });
    assert.ok(ack.ok);

    const message = await received;
    assert.equal(message.id, ack.data.id);
    assert.ok(message.type === 'user');
    assert.equal(message.author.nickname, 'Відправник');
    assert.equal((await echoed).id, ack.data.id, 'the sender sees their own message too');
  });

  it('gives newcomers the recent history', async () => {
    const author = await join('Автор');
    const ack = await send(author.socket, { text: 'для історії' });
    assert.ok(ack.ok);

    const newcomer = await join('Новачок');
    assert.ok(newcomer.snapshot.history.some((m) => m.id === ack.data.id));
  });

  it('rejects invalid payloads with VALIDATION_ERROR', async () => {
    const { socket } = await join('Валідатор');

    for (const payload of [{ text: '   ' }, { text: 42 } as unknown as SendMessagePayload]) {
      const ack = await send(socket, payload);
      assert.equal(ack.ok ? 'ok' : ack.error.code, 'VALIDATION_ERROR');
    }
  });

  it('rate-limits message floods', async () => {
    const { socket } = await join('Флудер');
    const codes: string[] = [];
    for (let i = 1; i <= 4; i += 1) {
      const ack = await send(socket, { text: `spam ${i}` });
      codes.push(ack.ok ? 'ok' : ack.error.code);
    }

    assert.deepEqual(codes, ['ok', 'ok', 'ok', 'RATE_LIMITED']);
  });

  it('broadcasts the auto message to every participant in every room every 21 seconds', async () => {
    const first = await join('Слухач', 'Перша');
    const second = await join('Слухачка', 'Друга');
    const isAuto = (m: EventArg<'message:new'>) => m.type === 'system' && m.text === AUTO_TEXT;
    const deliveries = [waitFor(first.socket, 'message:new', isAuto), waitFor(second.socket, 'message:new', isAuto)];

    scheduler.tick();

    assert.equal((await Promise.all(deliveries)).length, 2);
    assert.deepEqual(scheduler.intervals, [21_000], 'one global timer with the configured interval');
  });

  it('tells the others when a participant leaves', async () => {
    const staying = await join('Лишаюсь');
    const leaving = await join('Виходжу');
    const left = waitFor(staying.socket, 'participant:left', (p) => p.id === leaving.snapshot.self.id);

    leaving.socket.disconnect();

    assert.equal((await left).nickname, 'Виходжу');
  });
});

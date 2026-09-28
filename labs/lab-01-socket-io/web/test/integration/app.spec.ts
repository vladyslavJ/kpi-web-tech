import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { App } from '../../src/app/app';
import { ChatGateway } from '../../src/app/chat/data-access/chat-gateway';
import {
  participant,
  presenceMessage,
  snapshot,
  systemMessage,
  userMessage,
} from '../fixtures/chat-fixtures';
import { FakeChatGateway } from '../fakes/fake-chat-gateway';

const AUTO_TEXT =
  'Автоматичне повідомлення від ст. Жукова Владислава Віталійовича гр. ІС-33 Варіант 11';

describe('App', () => {
  let fixture: ComponentFixture<App>;
  let gateway: FakeChatGateway;
  let page: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: ChatGateway, useClass: FakeChatGateway }],
    });
    gateway = TestBed.inject(ChatGateway) as FakeChatGateway;
    fixture = TestBed.createComponent(App);
    page = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  function type(selector: string, value: string): void {
    const input = page.querySelector<HTMLInputElement>(selector);
    if (!input) {
      throw new Error(`${selector} is not rendered`);
    }
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  async function submitJoin(nickname: string, room?: string): Promise<void> {
    type('#nickname', nickname);
    if (room !== undefined) {
      type('#room', room);
    }
    page.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
  }

  it('joins the typed room with the typed nickname and renders the chat', async () => {
    expect(page.querySelector('h1')?.textContent).toContain('Чат у реальному часі');

    expect(page.querySelector<HTMLInputElement>('#room')?.value).toBe('Загальна');

    await submitJoin('Аліса', 'ІС-33');
    expect(gateway.request).toEqual({ nickname: 'Аліса', room: 'ІС-33' });

    const alice = participant('p-alice', 'Аліса');
    const bohdan = participant('p-bohdan', 'Богдан');
    gateway.emit({ type: 'status', status: 'connected' });
    gateway.emit({
      type: 'snapshot',
      snapshot: snapshot(alice, [alice, bohdan], [userMessage('m-1', bohdan, 'Привіт, Алісо!')], {
        id: 'іс-33',
        name: 'ІС-33',
      }),
    });
    gateway.emit({ type: 'message', message: systemMessage('auto-1', AUTO_TEXT) });
    await fixture.whenStable();

    expect(page.querySelector('app-join-form')).toBeNull();
    expect(page.querySelector('.topbar h1')?.textContent).toContain('ІС-33');
    expect(page.querySelectorAll('app-participant-list li')).toHaveLength(2);
    expect(page.querySelector('.bubble .text')?.textContent).toBe('Привіт, Алісо!');
    expect(page.querySelector('.system')?.textContent).toContain(AUTO_TEXT);
  });

  it('shows who joins and leaves the room, and our own arrival', async () => {
    await submitJoin('Аліса');
    const alice = participant('p-alice', 'Аліса');
    const bohdan = participant('p-bohdan', 'Богдан');
    gateway.emit({ type: 'message', message: presenceMessage('pr-1', 'joined', alice) });
    gateway.emit({ type: 'status', status: 'connected' });
    gateway.emit({ type: 'snapshot', snapshot: snapshot(alice, [alice]) });
    gateway.emit({
      type: 'message',
      message: presenceMessage('pr-2', 'joined', bohdan, '2026-09-27T12:00:01.000Z'),
    });
    gateway.emit({
      type: 'message',
      message: presenceMessage('pr-3', 'left', bohdan, '2026-09-27T12:00:02.000Z'),
    });
    await fixture.whenStable();

    const notices = [...page.querySelectorAll('.presence span')].map((el) =>
      el.textContent?.trim(),
    );
    expect(notices).toEqual([
      'Ви увійшли до кімнати',
      'Богдан приєднується до кімнати',
      'Богдан виходить з кімнати',
    ]);
  });

  it('shows validation errors instead of connecting with an invalid nickname or room', async () => {
    await submitJoin('<b>', 'x');

    expect(gateway.request).toBeNull();
    expect(page.querySelectorAll('[role="alert"]')).toHaveLength(2);
    expect(page.querySelector('[role="alert"]')?.textContent).toContain('2–32 символи');
  });
});

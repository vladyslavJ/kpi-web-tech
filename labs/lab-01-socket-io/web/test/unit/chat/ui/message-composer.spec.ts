import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { Mock } from 'vitest';
import { MessageComposer } from '../../../../src/app/chat/ui/message-composer/message-composer';

describe('MessageComposer', () => {
  let fixture: ComponentFixture<MessageComposer>;
  let sent: Mock<() => void>;

  beforeEach(async () => {
    fixture = TestBed.createComponent(MessageComposer);
    fixture.componentRef.setInput('draft', 'Привіт');
    sent = vi.fn<() => void>();
    fixture.componentInstance.send.subscribe(sent);
    await fixture.whenStable();
  });

  function press(init: KeyboardEventInit): void {
    const textarea = (fixture.nativeElement as HTMLElement).querySelector('textarea');
    textarea?.dispatchEvent(new KeyboardEvent('keydown', { cancelable: true, ...init }));
  }

  it('sends on Enter but not on Shift+Enter', () => {
    press({ key: 'Enter', shiftKey: true });
    expect(sent).not.toHaveBeenCalled();

    press({ key: 'Enter' });
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it('does not send a blank draft or while offline', async () => {
    fixture.componentRef.setInput('draft', '   ');
    await fixture.whenStable();
    press({ key: 'Enter' });

    fixture.componentRef.setInput('draft', 'Привіт');
    fixture.componentRef.setInput('connected', false);
    await fixture.whenStable();
    press({ key: 'Enter' });

    expect(sent).not.toHaveBeenCalled();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button');
    expect(button?.disabled).toBe(true);
  });
});

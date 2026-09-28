import { DatePipe } from '@angular/common';
import { afterRenderEffect, Component, ElementRef, input, viewChild } from '@angular/core';
import type { MessageDto, PresenceMessageDto } from '../../data-access/contract';

@Component({
  selector: 'app-message-list',
  imports: [DatePipe],
  templateUrl: './message-list.html',
  styleUrl: './message-list.css',
})
export class MessageList {
  readonly messages = input.required<readonly MessageDto[]>();
  readonly ownIds = input.required<ReadonlySet<string>>();

  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  #stickToBottom = true;

  constructor() {
    afterRenderEffect(() => {
      this.messages();
      const element = this.scroller().nativeElement;
      if (this.#stickToBottom) {
        element.scrollTop = element.scrollHeight;
      }
    });
  }

  protected onScroll(): void {
    const element = this.scroller().nativeElement;
    this.#stickToBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
  }

  protected isOwn(message: MessageDto): boolean {
    return message.type === 'user' && this.ownIds().has(message.author.id);
  }

  protected presenceText(message: PresenceMessageDto): string {
    if (this.ownIds().has(message.participant.id)) {
      return message.event === 'joined' ? 'Ви увійшли до кімнати' : 'Ви вийшли з кімнати';
    }
    return message.event === 'joined'
      ? `${message.participant.nickname} приєднується до кімнати`
      : `${message.participant.nickname} виходить з кімнати`;
  }
}

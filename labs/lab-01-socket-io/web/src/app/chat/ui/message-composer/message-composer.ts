import { Component, computed, input, model, output } from '@angular/core';
import { MESSAGE_MAX_LENGTH } from '../../data-access/chat-rules';

@Component({
  selector: 'app-message-composer',
  templateUrl: './message-composer.html',
  styleUrl: './message-composer.css',
})
export class MessageComposer {
  readonly draft = model.required<string>();
  readonly connected = input(true);
  readonly sending = input(false);
  readonly error = input<string | null>(null);
  readonly send = output<void>();

  protected readonly maxLength = MESSAGE_MAX_LENGTH;
  protected readonly length = computed(() => this.draft().trim().length);
  protected readonly canSubmit = computed(
    () =>
      this.connected() && !this.sending() && this.length() > 0 && this.length() <= this.maxLength,
  );

  protected onInput(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.submit();
    }
  }

  protected submit(): void {
    if (this.canSubmit()) {
      this.send.emit();
    }
  }
}

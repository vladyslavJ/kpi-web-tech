import { Component, computed, inject, signal } from '@angular/core';
import {
  form,
  FormField,
  FormRoot,
  maxLength,
  required,
  validate,
  type SchemaPath,
} from '@angular/forms/signals';
import {
  DEFAULT_ROOM,
  isValidName,
  NAME_HINT,
  NAME_MAX_LENGTH,
  normalizeName,
} from '../../data-access/chat-rules';
import { ChatStore } from '../../data-access/chat-store';

function nameRules(path: SchemaPath<string>, requiredMessage: string): void {
  required(path, { message: requiredMessage });
  maxLength(path, NAME_MAX_LENGTH, { message: NAME_HINT });
  validate(path, ({ value }) =>
    value() === '' || isValidName(value()) ? undefined : { kind: 'name', message: NAME_HINT },
  );
}

@Component({
  selector: 'app-join-form',
  imports: [FormField, FormRoot],
  templateUrl: './join-form.html',
  styleUrl: './join-form.css',
})
export class JoinForm {
  protected readonly store = inject(ChatStore);
  protected readonly hint = NAME_HINT;

  readonly #model = signal({ nickname: '', room: DEFAULT_ROOM });

  protected readonly form = form(
    this.#model,
    (path) => {
      nameRules(path.nickname, 'Введіть нікнейм');
      nameRules(path.room, 'Введіть назву кімнати');
    },
    {
      submission: {
        action: async (field) => {
          this.store.join({
            nickname: normalizeName(field.nickname().value()),
            room: normalizeName(field.room().value()),
          });
          return undefined;
        },
      },
    },
  );

  protected readonly nicknameError = computed(() => this.#firstError(this.form.nickname));
  protected readonly roomError = computed(() => this.#firstError(this.form.room));

  protected cancel(): void {
    this.store.leave();
  }

  #firstError(field: typeof this.form.nickname): string | null {
    const state = field();
    return state.touched() && state.invalid() ? (state.errors()[0]?.message ?? NAME_HINT) : null;
  }
}

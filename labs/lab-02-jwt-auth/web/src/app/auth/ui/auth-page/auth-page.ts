import { Component, computed, inject, input, signal } from '@angular/core';
import {
  applyWhen,
  form,
  FormField,
  FormRoot,
  maxLength,
  minLength,
  pattern,
  required,
  validate,
} from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { describeApiError } from '../../data-access/api-errors';
import { AuthApi } from '../../data-access/auth-api';
import {
  PASSWORD_HINT,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_HINT,
  USERNAME_PATTERN,
} from '../../data-access/auth-rules';
import { AuthStore } from '../../data-access/auth-store';

export type AuthMode = 'login' | 'register';

@Component({
  selector: 'app-auth-page',
  imports: [FormField, FormRoot, RouterLink],
  templateUrl: './auth-page.html',
  styleUrl: './auth-page.css',
})
export class AuthPage {
  readonly mode = input<AuthMode>('login');

  protected readonly store = inject(AuthStore);
  readonly #api = inject(AuthApi);
  readonly #router = inject(Router);

  protected readonly usernameHint = USERNAME_HINT;
  protected readonly passwordHint = PASSWORD_HINT;
  protected readonly isRegister = computed(() => this.mode() === 'register');
  protected readonly serverError = signal<string | null>(null);

  readonly #model = signal({ username: '', password: '', confirmation: '' });

  protected readonly form = form(
    this.#model,
    (path) => {
      required(path.username, { message: 'Введіть ім’я користувача' });
      required(path.password, { message: 'Введіть пароль' });
      applyWhen(
        path,
        () => this.isRegister(),
        (registration) => {
          pattern(registration.username, USERNAME_PATTERN, { message: USERNAME_HINT });
          minLength(registration.password, PASSWORD_MIN_LENGTH, { message: PASSWORD_HINT });
          maxLength(registration.password, PASSWORD_MAX_LENGTH, { message: PASSWORD_HINT });
          pattern(registration.password, /\S/, { message: PASSWORD_HINT });
          validate(registration.confirmation, ({ value, valueOf }) =>
            value() === valueOf(registration.password)
              ? undefined
              : { kind: 'mismatch', message: 'Паролі не збігаються' },
          );
        },
      );
    },
    {
      submission: {
        action: async (field) => {
          const { username, password } = field().value();
          this.serverError.set(null);
          try {
            const credentials = { username: username.trim(), password };
            const response = this.isRegister()
              ? await this.#api.register(credentials)
              : await this.#api.login(credentials);
            this.store.signIn(response);
            await this.#router.navigateByUrl('/profile');
          } catch (error) {
            this.serverError.set(describeApiError(error));
          }
          return undefined;
        },
      },
    },
  );

  protected readonly usernameError = computed(() => this.#firstError(this.form.username));
  protected readonly passwordError = computed(() => this.#firstError(this.form.password));
  protected readonly confirmationError = computed(() => this.#firstError(this.form.confirmation));

  #firstError(field: typeof this.form.username): string | null {
    const state = field();
    return state.touched() && state.invalid() ? (state.errors()[0]?.message ?? null) : null;
  }
}

import { HttpContextToken, HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { apiErrorCode } from './api-errors';
import { AuthStore, EXPIRED_NOTICE } from './auth-store';

export const SKIP_AUTH = new HttpContextToken<boolean>(() => false);

const SIGN_OUT_NOTICES: Readonly<Record<string, string>> = {
  TOKEN_EXPIRED: EXPIRED_NOTICE,
  INVALID_TOKEN: 'Сервер не прийняв токен. Увійдіть знову.',
  UNAUTHORIZED: 'Обліковий запис більше не існує або сесія недійсна.',
};

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (request.context.get(SKIP_AUTH) || !request.url.startsWith('/api/')) {
    return next(request);
  }

  const store = inject(AuthStore);
  const token = store.token();
  const authorized = token
    ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : request;

  return next(authorized).pipe(
    catchError((error: unknown) => {
      if (token && error instanceof HttpErrorResponse && error.status === 401) {
        store.signOut(SIGN_OUT_NOTICES[apiErrorCode(error) ?? 'UNAUTHORIZED'] ?? null);
      }
      return throwError(() => error);
    }),
  );
};

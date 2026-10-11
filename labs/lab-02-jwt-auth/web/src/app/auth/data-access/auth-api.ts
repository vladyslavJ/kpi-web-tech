import { HttpClient, HttpContext, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiErrorCode } from './api-errors';
import { SKIP_AUTH } from './auth-interceptor';
import type { AuthResponse, CredentialsRequest, ErrorCode, Role, UserResponse } from './contract';

export interface ProbeResult {
  readonly status: number;
  readonly code: ErrorCode | null;
}

@Injectable({ providedIn: 'root' })
export class AuthApi {
  readonly #http = inject(HttpClient);

  register(credentials: CredentialsRequest): Promise<AuthResponse> {
    return firstValueFrom(this.#http.post<AuthResponse>('/api/auth/register', credentials));
  }

  login(credentials: CredentialsRequest): Promise<AuthResponse> {
    return firstValueFrom(this.#http.post<AuthResponse>('/api/auth/login', credentials));
  }

  changeRole(userId: string, role: Role): Promise<UserResponse> {
    return firstValueFrom(
      this.#http.patch<UserResponse>(`/api/users/${encodeURIComponent(userId)}/role`, { role }),
    );
  }

  deleteUser(userId: string): Promise<UserResponse> {
    return firstValueFrom(
      this.#http.delete<UserResponse>(`/api/users/${encodeURIComponent(userId)}`),
    );
  }

  async probe(url: string, token: string | null): Promise<ProbeResult> {
    const headers = token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : undefined;
    try {
      const response = await firstValueFrom(
        this.#http.get(url, {
          headers,
          observe: 'response',
          context: new HttpContext().set(SKIP_AUTH, true),
        }),
      );
      return { status: response.status, code: null };
    } catch (error) {
      if (error instanceof HttpErrorResponse) {
        return { status: error.status, code: apiErrorCode(error) };
      }
      throw error;
    }
  }
}

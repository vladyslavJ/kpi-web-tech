import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthStore } from './auth-store';

export const authGuard: CanActivateFn = () =>
  inject(AuthStore).isAuthenticated() || inject(Router).createUrlTree(['/login']);

export const guestGuard: CanActivateFn = () =>
  !inject(AuthStore).isAuthenticated() || inject(Router).createUrlTree(['/profile']);

export const adminGuard: CanActivateFn = () =>
  inject(AuthStore).isAdmin() || inject(Router).createUrlTree(['/profile']);

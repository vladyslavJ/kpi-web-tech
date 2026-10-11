import { Routes } from '@angular/router';
import { adminGuard, authGuard, guestGuard } from './auth/data-access/auth-guards';
import { AdminUsers } from './auth/ui/admin-users/admin-users';
import { AuthPage } from './auth/ui/auth-page/auth-page';
import { Dashboard } from './auth/ui/dashboard/dashboard';
import { Shell } from './auth/ui/shell/shell';

export const routes: Routes = [
  {
    path: 'login',
    component: AuthPage,
    canActivate: [guestGuard],
    data: { mode: 'login' },
    title: 'Вхід · JWT-авторизація',
  },
  {
    path: 'register',
    component: AuthPage,
    canActivate: [guestGuard],
    data: { mode: 'register' },
    title: 'Реєстрація · JWT-авторизація',
  },
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'profile' },
      { path: 'profile', component: Dashboard, title: 'Профіль · JWT-авторизація' },
      {
        path: 'users',
        component: AdminUsers,
        canActivate: [adminGuard],
        title: 'Користувачі · JWT-авторизація',
      },
    ],
  },
  { path: '**', redirectTo: '' },
];

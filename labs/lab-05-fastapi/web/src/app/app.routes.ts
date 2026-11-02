import { Routes } from '@angular/router';
import { Home } from './catalog/ui/home/home';
import { OperationTypeForm } from './catalog/ui/operation-type-form/operation-type-form';
import { OperationTypeList } from './catalog/ui/operation-type-list/operation-type-list';
import { PartForm } from './catalog/ui/part-form/part-form';
import { PartList } from './catalog/ui/part-list/part-list';
import { ProcessCardDetails } from './catalog/ui/process-card-details/process-card-details';
import { ProcessCardForm } from './catalog/ui/process-card-form/process-card-form';
import { ProcessCardList } from './catalog/ui/process-card-list/process-card-list';
import { Shell } from './catalog/ui/shell/shell';

const TITLE = 'Технологічні карти';

export const routes: Routes = [
  {
    path: '',
    component: Shell,
    children: [
      { path: '', pathMatch: 'full', component: Home, title: `Головна · ${TITLE}` },
      { path: 'process-cards', component: ProcessCardList, title: TITLE },
      { path: 'process-cards/new', component: ProcessCardForm, title: `Нова карта · ${TITLE}` },
      { path: 'process-cards/:id', component: ProcessCardDetails, title: `Карта · ${TITLE}` },
      {
        path: 'process-cards/:id/edit',
        component: ProcessCardForm,
        title: `Редагування карти · ${TITLE}`,
      },
      { path: 'parts', component: PartList, title: `Деталі · ${TITLE}` },
      { path: 'parts/new', component: PartForm, title: `Нова деталь · ${TITLE}` },
      { path: 'parts/:id/edit', component: PartForm, title: `Редагування деталі · ${TITLE}` },
      { path: 'operation-types', component: OperationTypeList, title: `Види обробки · ${TITLE}` },
      {
        path: 'operation-types/new',
        component: OperationTypeForm,
        title: `Новий вид обробки · ${TITLE}`,
      },
      {
        path: 'operation-types/:id/edit',
        component: OperationTypeForm,
        title: `Редагування виду обробки · ${TITLE}`,
      },
      {
        path: 'docs',
        loadComponent: () => import('./catalog/ui/api-docs/api-docs').then((m) => m.ApiDocs),
        title: `API · ${TITLE}`,
      },
    ],
  },
  { path: '**', redirectTo: '' },
];

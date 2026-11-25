import { Routes } from '@angular/router';
import { Start } from './pages/start/start';

export const routes: Routes = [
  {
    path: '',
    component: Start,
    title: 'Occoneechee Registration - You have two ways to get started.',
  },
  { path: '**', redirectTo: '' },
];

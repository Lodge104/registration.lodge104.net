import { Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { CONTACT_EMAIL } from './site-config';

@Component({
  imports: [RouterOutlet, RouterLink],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly contactEmail = CONTACT_EMAIL;
  protected readonly year = new Date().getFullYear();
  protected readonly version = '1.0.0';
}

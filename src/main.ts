import { bootstrapApplication } from '@angular/platform-browser';
import { Amplify } from 'aws-amplify';
import outputs from '../amplify_outputs.json';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// amplify_outputs.json is generated (and gitignored) by `npx ampx sandbox`
// locally, or by `npx ampx pipeline-deploy` during the Amplify Hosting build.
Amplify.configure(outputs);

bootstrapApplication(App, appConfig).catch((err) => console.error(err));

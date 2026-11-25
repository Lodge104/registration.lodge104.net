import { defineBackend } from '@aws-amplify/backend';
import { data } from './data/resource';
import { sayHello } from './functions/say-hello/resource';

/**
 * Amplify Gen2 backend definition.
 * @see https://docs.amplify.aws/angular/build-a-backend/
 *
 * No authentication (Cognito) is configured — the API is accessed with an
 * AppSync API key (see ./data/resource.ts).
 */
defineBackend({
  data,
  sayHello,
});

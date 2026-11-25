import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { sayHello } from '../functions/say-hello/resource';

/**
 * Data / API layer (AWS AppSync).
 *
 * Lambda functions are exposed to the Angular app as custom queries/mutations
 * that use the Lambda as the resolver. The frontend calls them with the
 * Amplify Data client: `client.queries.sayHello({ name: '...' })`.
 *
 * Since this app has no authentication, every operation uses
 * `allow.publicApiKey()`.
 */
const schema = a.schema({
  sayHello: a
    .query()
    .arguments({ name: a.string() })
    .returns(a.string())
    .handler(a.handler.function(sayHello))
    .authorization((allow) => [allow.publicApiKey()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'apiKey',
    apiKeyAuthorizationMode: {
      // Max is 365. Redeploying the backend rotates/renews the key.
      expiresInDays: 365,
    },
  },
});

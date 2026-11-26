import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { registrationApi } from '../functions/registration-api/resource';

/**
 * Data / API layer (AWS AppSync).
 *
 * No Amplify-managed tables: both operations are custom queries/mutations
 * resolved by the registration-api Lambda, which reads the existing
 * lodge104-member_data and lodge104-keys DynamoDB tables.
 *
 * The app has no authentication, so every operation uses `allow.publicApiKey()`.
 */
const schema = a.schema({
  LookupStatus: a.enum(['FOUND', 'NOT_FOUND', 'AMBIGUOUS']),
  PortalAction: a.enum([
    'ACCOUNT_ACTIVE',
    'CREATE_ACCOUNT',
    'RESEND_INVITE',
    'UNDER_AGE',
    'UNKNOWN',
  ]),

  LookupResult: a.customType({
    status: a.ref('LookupStatus').required(),
    action: a.ref('PortalAction'),
    firstName: a.string(),
    email: a.string(),
    lookupToken: a.string(),
    /** Set for under-13 members only. */
    duesYear: a.integer(),
    requiredDuesYear: a.integer(),
    duesCurrent: a.boolean(),
  }),

  DuesLinkResult: a.customType({
    success: a.boolean().required(),
    message: a.string().required(),
    link: a.string(),
    bsaId: a.string(),
  }),

  InviteResult: a.customType({
    success: a.boolean().required(),
    message: a.string().required(),
    email: a.string(),
    expiresAt: a.string(),
  }),

  RegistrationEvent: a.customType({
    id: a.string().required(),
    name: a.string().required(),
    location: a.string(),
    startDateTime: a.string().required(),
    endDateTime: a.string(),
  }),

  EventListResult: a.customType({
    success: a.boolean().required(),
    message: a.string().required(),
    /** True when only Ordeal inductions are offered (the member is a candidate). */
    candidate: a.boolean().required(),
    events: a.ref('RegistrationEvent').array().required(),
  }),

  EventLinkResult: a.customType({
    success: a.boolean().required(),
    message: a.string().required(),
    link: a.string(),
  }),

  /** Find a member by BSA ID, or by first + last name and birthdate (YYYY-MM-DD). */
  lookupMember: a
    .query()
    .arguments({
      bsaId: a.string(),
      firstName: a.string(),
      lastName: a.string(),
      birthDate: a.string(),
    })
    .returns(a.ref('LookupResult'))
    .handler(a.handler.function(registrationApi))
    .authorization((allow) => [allow.publicApiKey()]),

  /** Create a LodgeMaster portal account, or resend its invitation, for a looked-up member. */
  sendPortalInvite: a
    .mutation()
    .arguments({
      lookupToken: a.string().required(),
      email: a.string().required(),
    })
    .returns(a.ref('InviteResult'))
    .handler(a.handler.function(registrationApi))
    .authorization((allow) => [allow.publicApiKey()]),

  /** LodgeMaster dues-payment link for a looked-up under-13 member whose dues are not current. */
  requestDuesLink: a
    .query()
    .arguments({ lookupToken: a.string().required() })
    .returns(a.ref('DuesLinkResult'))
    .handler(a.handler.function(registrationApi))
    .authorization((allow) => [allow.publicApiKey()]),

  /** Upcoming events an under-13 member with current dues can register for online. */
  listEvents: a
    .query()
    .arguments({ lookupToken: a.string().required() })
    .returns(a.ref('EventListResult'))
    .handler(a.handler.function(registrationApi))
    .authorization((allow) => [allow.publicApiKey()]),

  /** The member's LodgeMaster registration link for one event from listEvents. */
  requestEventRegistrationLink: a
    .query()
    .arguments({ lookupToken: a.string().required(), eventId: a.string().required() })
    .returns(a.ref('EventLinkResult'))
    .handler(a.handler.function(registrationApi))
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

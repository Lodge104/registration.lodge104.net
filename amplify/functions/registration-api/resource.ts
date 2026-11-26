import { defineFunction } from '@aws-amplify/backend';

/**
 * Member lookup, LodgeMaster portal-account actions, dues links and event
 * registration for the registration site (see ../../data/resource.ts).
 *
 * Reads three pre-existing, externally owned DynamoDB tables (granted
 * read-only in ../../backend.ts):
 *   - lodge104-member_data  (owned by the lodge104-memberdata stack)
 *   - lodge104-event_data   (LodgeMaster events)
 *   - lodge104-keys         (LodgeMaster session cookies, refreshed by the
 *                            keys.lodgemaster.lambda.lodge104.net scraper)
 */
export const registrationApi = defineFunction({
  name: 'registration-api',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 20,
  memoryMB: 256,
  environment: {
    MEMBER_DATA_TABLE_NAME: 'lodge104-member_data',
    EVENT_DATA_TABLE_NAME: 'lodge104-event_data',
    KEYS_TABLE_NAME: 'lodge104-keys',
    LODGEMASTER_BASE_URL: 'https://lodgemaster-client.oa-scouting.org',
    /** Members younger than this are not offered portal-account actions. */
    MIN_PORTAL_AGE: '13',
  },
});

import { defineBackend } from '@aws-amplify/backend';
import { Stack } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { CfnWebACL, CfnWebACLAssociation } from 'aws-cdk-lib/aws-wafv2';
import { data } from './data/resource';
import { registrationApi } from './functions/registration-api/resource';

/**
 * Amplify Gen2 backend definition.
 * @see https://docs.amplify.aws/angular/build-a-backend/
 *
 * No authentication (Cognito) is configured — the API is accessed with an
 * AppSync API key (see ./data/resource.ts), so abuse protection lives here:
 * a WAF rate limit on the API and a cap on Lambda concurrency.
 */
const backend = defineBackend({
  data,
  registrationApi,
});

const lambda = backend.registrationApi.resources.lambda;
const lambdaStack = Stack.of(lambda);
const { region, account } = lambdaStack;

// ---------------------------------------------------------------------------
// Sandbox vs. branch deployments
//
// The function reads the live member/session-cookie tables and can trigger real
// LodgeMaster emails and payment links. Personal sandboxes (`ampx sandbox`) get
// the same read access as the developer who runs them, but must never send
// invitations or fetch dues links with the live LodgeMaster session, so those
// side effects are enabled for Amplify Hosting *branch* deployments only.
// ---------------------------------------------------------------------------
const deploymentType = backend.stack.node.tryGetContext('amplify-backend-type') as
  'branch' | 'sandbox' | 'standalone' | undefined;
const sideEffectsEnabled = deploymentType === 'branch';
backend.registrationApi.addEnvironment('SIDE_EFFECTS_ENABLED', String(sideEffectsEnabled));

// ---------------------------------------------------------------------------
// Existing, externally owned tables (read-only, referenced by ARN so Amplify
// never modifies them).
// ---------------------------------------------------------------------------
const tableArn = (name: string) => `arn:aws:dynamodb:${region}:${account}:table/${name}`;

lambda.addToRolePolicy(
  new PolicyStatement({
    sid: 'ReadMemberData',
    actions: ['dynamodb:Query', 'dynamodb:Scan'],
    resources: [tableArn('lodge104-member_data')],
  }),
);
lambda.addToRolePolicy(
  new PolicyStatement({
    sid: 'ReadLodgeMasterSessionCookies',
    actions: ['dynamodb:Scan'],
    resources: [tableArn('lodge104-keys')],
  }),
);
lambda.addToRolePolicy(
  new PolicyStatement({
    sid: 'ReadEventData',
    actions: ['dynamodb:Scan'],
    resources: [tableArn('lodge104-event_data')],
  }),
);
lambda.addToRolePolicy(
  new PolicyStatement({
    sid: 'ReadEventAttendeesByMember',
    actions: ['dynamodb:Query'],
    resources: [`${tableArn('lodge104-event_attendees')}/index/BsaPersonId-index`],
  }),
);

// ---------------------------------------------------------------------------
// Lookup-token signing key: a random 64-character secret generated per
// deployment, readable only by this function.
// ---------------------------------------------------------------------------
const lookupTokenKey = new Secret(lambdaStack, 'LookupTokenKey', {
  description: 'HMAC key that signs registration lookup tokens',
  generateSecretString: { passwordLength: 64, excludePunctuation: true },
});
lookupTokenKey.grantRead(lambda);
backend.registrationApi.addEnvironment('LOOKUP_TOKEN_SECRET_ARN', lookupTokenKey.secretArn);

// ---------------------------------------------------------------------------
// Abuse controls
// ---------------------------------------------------------------------------

// Cap concurrent executions so a flood can't exhaust DynamoDB read capacity or
// hammer LodgeMaster. Excess requests are throttled rather than queued.
backend.registrationApi.resources.cfnResources.cfnFunction.reservedConcurrentExecutions = 10;

// Per-IP rate limit in front of the (public, API-key) AppSync API.
const wafStack = backend.createStack('RegistrationWaf');
const rateLimitMetric = 'RegistrationApiRateLimit';
const webAcl = new CfnWebACL(wafStack, 'ApiWebAcl', {
  scope: 'REGIONAL',
  defaultAction: { allow: {} },
  visibilityConfig: {
    cloudWatchMetricsEnabled: true,
    metricName: 'RegistrationApi',
    sampledRequestsEnabled: true,
  },
  rules: [
    {
      name: 'RateLimitPerIp',
      priority: 0,
      action: { block: {} },
      statement: {
        rateBasedStatement: {
          // At most 100 requests per client IP in any 5-minute window. A real
          // visit makes only a handful of API calls.
          limit: 100,
          evaluationWindowSec: 300,
          aggregateKeyType: 'IP',
        },
      },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: rateLimitMetric,
        sampledRequestsEnabled: true,
      },
    },
  ],
});
new CfnWebACLAssociation(wafStack, 'ApiWebAclAssociation', {
  resourceArn: backend.data.resources.graphqlApi.arn,
  webAclArn: webAcl.attrArn,
});

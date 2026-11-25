import { defineBackend } from '@aws-amplify/backend';
import { Stack } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { data } from './data/resource';
import { registrationApi } from './functions/registration-api/resource';

/**
 * Amplify Gen2 backend definition.
 * @see https://docs.amplify.aws/angular/build-a-backend/
 *
 * No authentication (Cognito) is configured — the API is accessed with an
 * AppSync API key (see ./data/resource.ts).
 */
const backend = defineBackend({
  data,
  registrationApi,
});

// Read-only access to the two pre-existing, externally owned tables. These are
// referenced by ARN (not imported/managed), so Amplify never modifies them.
const lambda = backend.registrationApi.resources.lambda;
const { region, account } = Stack.of(lambda);
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

# registration.lodge104.net

Angular frontend + AWS Amplify Gen2 backend (Lambda functions exposed through AppSync),
deployed with Amplify Hosting (App ID `d1c2x4zpjcxv7w`).

Based on [aws-samples/amplify-angular-template](https://github.com/aws-samples/amplify-angular-template),
updated to the current Angular CLI. **No authentication** is configured — the API uses an AppSync API key.

## Project layout

```text
amplify/                          # Amplify Gen2 backend (TypeScript, CDK under the hood)
├── backend.ts                    # defineBackend + IAM, signing secret, WAF rate limit, concurrency cap
├── data/resource.ts              # AppSync schema: member lookup, invites, dues and event links
└── functions/
    └── registration-api/         # The Lambda behind every operation
        ├── handler.ts            # Member lookup, LodgeMaster invite / dues / event-link calls
        ├── events.ts             # Which events an under-13 member can register for
        ├── lookup-token.ts       # HMAC-signed lookup tokens
        ├── lodge-date.ts         # Age and dues-year rules, in the lodge time zone
        ├── roster.ts             # Cached name + birthdate index
        └── resource.ts           # defineFunction (runtime, timeout, env)
src/                              # Angular app
├── main.ts                       # Amplify.configure(amplify_outputs.json)
├── polyfills.ts                  # Node globals required by Amplify JS
└── app/
    ├── api.service.ts            # Typed Amplify Data client wrapper
    ├── site-config.ts            # Shared constants (contact email)
    ├── member-session.ts         # In-memory lookup token shared between pages
    └── pages/
        ├── start/                # The registration start page and its popups
        └── events/               # Upcoming events for under-13 members with current dues
amplify.yml                       # Amplify Hosting build spec (backend + frontend)
```

## Local development

Requires Node 24 (see `.nvmrc`) and AWS credentials.

```bash
npm install

# Terminal 1 – deploy a personal cloud sandbox & watch amplify/ for changes.
# Generates amplify_outputs.json (gitignored), which the Angular app imports.
npm run sandbox

# Terminal 2 – Angular dev server on http://localhost:4200
npm start
```

To develop against the deployed `main` backend instead of a sandbox:
`npm run outputs`.

Tear down your sandbox with `npm run sandbox:delete`.

## Security and abuse controls

The site has no login, so the AppSync API is public (API key). These controls limit abuse:

- **Rate limit:** an AWS WAF rule blocks any IP making more than 100 API requests in 5 minutes.
- **Concurrency cap:** the Lambda is limited to 10 concurrent executions, so a flood is throttled
  instead of draining DynamoDB or hammering LodgeMaster.
- **No scan per request:** name + birthdate lookups use a small in-memory index that each Lambda
  container rebuilds from one projected scan at most every 5 minutes (`roster.ts`). Lookups by
  member ID are direct key queries.
- **Signed lookup tokens:** `sendPortalInvite` and `requestDuesLink` need the token returned by a
  successful `lookupMember`. Tokens are HMAC-signed with a per-deployment secret (Secrets Manager)
  and expire after 30 minutes, so they can't be forged for an arbitrary member.
- **Sandboxes are read-only for side effects:** the function reads the live member and
  session-cookie tables, so `npm run sandbox` can look members up, but sending invitations and
  fetching dues links only work on Amplify Hosting branch deployments
  (`SIDE_EFFECTS_ENABLED`, set in `amplify/backend.ts`).

The API key is visible to anyone who loads the site; none of the above relies on keeping it secret.

## Adding a Lambda function

1. Create `amplify/functions/<name>/resource.ts` (`defineFunction`) and `handler.ts`.
2. Expose it in `amplify/data/resource.ts` as an `a.query()` / `a.mutation()` with
   `.handler(a.handler.function(<fn>))` and `.authorization((allow) => [allow.publicApiKey()])`.
3. Add it to `defineBackend({...})` in `amplify/backend.ts`.
4. Call it from Angular via `client.queries.<name>(...)` / `client.mutations.<name>(...)`.

## Deployment

Pushing to `main` triggers Amplify Hosting, which runs `amplify.yml`:
`ampx pipeline-deploy` deploys the backend, then `ng build` outputs to `dist/registration/browser`.

The Amplify app needs a service role with `AmplifyBackendDeployFullAccess` for backend deploys.

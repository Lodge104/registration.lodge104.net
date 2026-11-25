# registration.lodge104.net

Angular frontend + AWS Amplify Gen2 backend (Lambda functions exposed through AppSync),
deployed with Amplify Hosting (App ID `d1c2x4zpjcxv7w`).

Based on [aws-samples/amplify-angular-template](https://github.com/aws-samples/amplify-angular-template),
updated to the current Angular CLI. **No authentication** is configured — the API uses an AppSync API key.

## Project layout

```text
amplify/                     # Amplify Gen2 backend (TypeScript, CDK under the hood)
├── backend.ts               # defineBackend({ data, ...functions })
├── data/resource.ts         # AppSync schema: custom queries/mutations → Lambda resolvers
└── functions/
    └── say-hello/           # Sample Lambda (resource.ts + handler.ts)
src/                         # Angular app
├── main.ts                  # Amplify.configure(amplify_outputs.json)
├── polyfills.ts             # Node globals required by Amplify JS
└── app/
    ├── api.service.ts       # Typed Amplify Data client wrapper
    └── home/                # Sample page calling the Lambda
amplify.yml                  # Amplify Hosting build spec (backend + frontend)
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

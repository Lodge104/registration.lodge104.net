// Amplify JS expects a few Node globals that browsers don't provide.
// (Carried over from https://github.com/aws-samples/amplify-angular-template)
(window as any).global = window;
(window as any).process = {
  env: { DEBUG: undefined },
};

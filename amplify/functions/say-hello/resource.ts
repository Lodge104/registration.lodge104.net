import { defineFunction } from '@aws-amplify/backend';

export const sayHello = defineFunction({
  name: 'say-hello',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 10,
});

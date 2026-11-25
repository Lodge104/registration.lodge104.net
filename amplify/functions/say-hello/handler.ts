import type { Schema } from '../../data/resource';

type Handler = Schema['sayHello']['functionHandler'];

/**
 * Sample Lambda resolver for the `sayHello` custom query.
 * Replace / add functions under amplify/functions/<name>/ as the app grows.
 */
export const handler: Handler = async (event) => {
  const name = event.arguments.name?.trim() || 'World';
  return `Hello, ${name}! (from Lambda)`;
};

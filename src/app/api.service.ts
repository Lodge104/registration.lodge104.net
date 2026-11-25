import { Injectable } from '@angular/core';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

/**
 * Thin wrapper around the Amplify Data client. Each Lambda-backed custom
 * query/mutation defined in amplify/data/resource.ts is available on
 * `client.queries` / `client.mutations` with full type safety.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly client = generateClient<Schema>();

  async sayHello(name: string): Promise<string> {
    const { data, errors } = await this.client.queries.sayHello({ name });
    if (errors?.length) {
      throw new Error(errors.map((e) => e.message).join(', '));
    }
    return data ?? '';
  }
}

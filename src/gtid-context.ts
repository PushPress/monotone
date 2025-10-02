/**
 * @module Create a context that can be used to set
 * and retrieve gtid values for a given asynchronous context.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type GTIDContext = {
  gtid: string;
};

const gtidContext = new AsyncLocalStorage<GTIDContext>();

export interface GTIDContextProvider {
  set(gtid: string): void;
  read(): GTIDContext | undefined;
}

export function init(gtid: string = '') {
  const ctx = { gtid };
  gtidContext.enterWith(ctx);
  return ctx;
}

export function read() {
  return gtidContext.getStore();
}

export function set(gtid: string) {
  const context = read() ?? init();
  context.gtid = gtid;
}

/**
 * Creates a GTID context for the current async execution context.
 * This function initializes a new GTID context that can be used to share
 * GTID values across async operations within the same request or execution flow.
 * 
 * @param gtid - Optional initial GTID value. If not provided, defaults to empty string.
 * @returns A GTIDContextProvider object with set() and read() methods for managing the context.
 * 
 * @example
 * ```typescript
 * // Create context for Express middleware
 * app.use((req, res, next) => {
 *   createGtidContext();
 *   next();
 * });
 * 
 * // Create context with initial GTID
 * const context = createGtidContext('initial-gtid-123');
 * context.set('updated-gtid-456');
 * const currentGtid = context.read()?.gtid;
 * ```
 * 
 * @example
 * ```typescript
 * // Create context for Fastify hook
 * fastify.addHook('preHandler', async (request, reply) => {
 *   createGtidContext();
 * });
 * ```
 */
export function createGtidContext(gtid?: string): GTIDContextProvider {
  init(gtid);
  return {
    set,
    read,
  };
}

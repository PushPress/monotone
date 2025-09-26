import { createPool, Pool, PoolOptions } from 'mysql2/promise';
import { Logger } from './logger';
import { GTIDReplicaSelector } from './replica-selector';


/**
 * Configuration options for a Monotone pool
 */
export interface MonotoneOptions {
  logger?: Logger;
  /**
   * When true, disables GTID-based synchronization for read queries.
   * Read queries will be routed directly to the first replica without
   * waiting for GTID synchronization. This provides simple read/write
   * splitting without consistency guarantees.
   */
  disabled?: boolean;
  primary: PoolOptions;
  timeout?: number;
  replicas: PoolOptions[];
}

/**
 * Pre-compiled regex for detecting read operations
 * Matches SQL keywords at the start of the string (after whitespace)
 */
const READ_QUERY_REGEX = /^\s*(select|show|describe|desc|explain|with)\b/i;

/**
 * Detect if a SQL query is a read operation
 * Uses a pre-compiled regex for optimal performance
 */
function isReadQuery(sql: string): boolean {
  return READ_QUERY_REGEX.test(sql);
}

/**
 * Create a proxy that routes queries between primary and replica pools
 */
function createPoolProxy({
  primary,
  replicas,
  logger,
  timeout,
  disabled,
}: {
  primary: Pool;
  replicas: Pool[];
  logger?: Logger;
  timeout?: number;
  disabled?: boolean;
}): Pool {
  const state = {
    replicas: [...replicas], // Create a copy to avoid external mutation
  };

  const selector = new GTIDReplicaSelector({
    primary,
    replicas,
    options: {
      logger,
      timeout,
    },
  });

  return new Proxy(primary, {
    get(target, prop, receiver) {
      // only intercept query method
      if (prop !== 'query') {
        return Reflect.get(target, prop, receiver);
      }

      return async function (...args: unknown[]) {
        const sql = args[0] as string;

        if (isReadQuery(sql)) {
          // Route read queries to replicas
          if (state.replicas.length === 0) {
            logger?.warn(
              'No replicas available, routing read query to primary',
            );
            return Reflect.apply(
              Reflect.get(target, 'query', receiver) as Pool['query'],
              receiver,
              args,
            );
          }

          if (state.replicas.length > 1) {
            logger?.warn(
              'Rotating between read replicas is not supported yet - will only use one replica',
            );
          }

          let selectedPool: Pool;

          // In disabled mode, route reads directly to first replica without GTID synchronization
          // This provides simple read/write splitting without consistency guarantees
          if (disabled) {
            selectedPool = state.replicas[0] ?? primary;
          } else {
            // Normal mode: use GTID-based synchronization to ensure replica consistency
            selectedPool = await selector.selectPool();
          }
          return selectedPool.query(...(args as Parameters<Pool['query']>));
        }

        // Default to primary for unrecognized queries (safer for writes)
        logger?.debug(
          {
            sql: sql.substring(0, 100) as string,
          },
          'Routing unrecognized query to primary (defaulting to write behavior)',
        );

        const result = await Reflect.apply(
          Reflect.get(target, 'query', receiver) as Pool['query'],
          receiver,
          args,
        );

        return result;
      } as Pool['query'];
    },
  });
}

/**
 * Create a Monotone pool that automatically routes queries between primary and replicas
 */
export const createMonotonePool = (options: MonotoneOptions): Pool => {
  const primary = createPool(options.primary);

  // track session ids so they are returned on writes
  primary.on('connection', async (conn) => {
    await conn.query('SET SESSION session_track_gtids = OWN_GTID');
  });
  const replicas = options.replicas.map((replicaConfig) =>
    createPool(replicaConfig),
  );

  return createPoolProxy({
    primary,
    replicas,
    timeout: options.timeout,
    logger: options.logger,
    disabled: options.disabled,
  });
};

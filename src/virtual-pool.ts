import { createPool, Pool, PoolOptions } from 'mysql2/promise';
import { Logger } from './logger';
import { ReplicaSelector } from './replica-selector';
import { isSelectQuery } from './mysql-parser';

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
  const selector = new ReplicaSelector({
    logger,
    replicas,
  });

  return new Proxy(primary, {
    get(target, prop, receiver) {
      // only intercept query method
      if (prop !== 'query') {
        return Reflect.get(target, prop, receiver);
      }

      return async function (...args: unknown[]) {
        const sql = args[0] as string;

        if (isSelectQuery(sql)) {
          const selected = selector.getNextReplica() ?? primary;

          // TODO: use async context to wait for reads when set

          return selected.query(...(args as Parameters<Pool['query']>));
        }

        // Default to primary for unrecognized queries (safer for writes)
        logger?.debug(
          {
            sql: sql.substring(0, 100) as string,
          },
          'Routing unrecognized query to primary (defaulting to write behavior)',
        );

        return Reflect.apply(
          Reflect.get(target, 'query', receiver) as Pool['query'],
          receiver,
          args,
        );
      } as Pool['query'];
    },
  });
}

/**
 * Create a Monotone pool that automatically routes queries between primary and replicas
 */
export const createVirtualPool = (options: MonotoneOptions): Pool => {
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

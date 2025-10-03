import { createPool, Pool, PoolOptions } from 'mysql2/promise';
import { Logger } from './logger';
import { ReplicaSelector } from './replica-selector';
import { isSelectQuery } from './mysql-parser';
import {
  GTID_CONTEXT_ENABLED_MODE,
  PoolMode as Mode,
  REPLICA_SELECTION_MODE,
  includesMode,
} from './pool-modes';
import { isSuccessfulReplication, waitForReplication } from './query-runner';
import * as Context from './gtid-context';

/**
 * Configuration options for a virtual pool
 */
export interface VirtualPoolOptions {
  logger?: Logger;
  primary: PoolOptions;
  timeout?: number;
  replicas: PoolOptions[];
  mode: Mode;
}

/**
 * Create a proxy that routes queries between primary and replica pools
 */
function createPoolProxy({
  primary,
  replicas,
  logger,
  mode,
  timeout,
}: {
  primary: Pool;
  replicas: Pool[];
  logger?: Logger;
  timeout?: number;
  mode: Mode;
}): Pool {
  const selector = new ReplicaSelector({
    logger,
    replicas,
  });

  const includesReplicaSelection = includesMode(mode, REPLICA_SELECTION_MODE);
  const includesGtidContext = includesMode(mode, GTID_CONTEXT_ENABLED_MODE);

  return new Proxy(primary, {
    get(target, prop, receiver) {
      // only intercept query method
      if (prop !== 'query') {
        return Reflect.get(target, prop, receiver);
      }

      let selected: Pool;
      let ctx: Context.GTIDContext | undefined;
      return async function (...args: unknown[]) {
        const sql = args[0] as string;

        if (isSelectQuery(sql) && includesReplicaSelection) {
          selected = selector.getNextReplica() ?? primary;

          // only read gtid context if it is enabled
          if (includesGtidContext) {
            ctx = Context.read();
          }

          if (ctx) {
            const result = await waitForReplication(
              selected,
              {
                gtidSet: ctx.gtid,
              },
              { logger, timeout: timeout ?? 0.05 }, // default to wait 50ms
            );

            // Fallback to primary if wait for replica is unsuccessful
            if (!isSuccessfulReplication(result)) {
              logger?.warn(
                {
                  sql: sql.substring(0, 100) as string,
                  gtid: ctx.gtid,
                },
                "Replica didn't respond in time, falling back to primary",
              );
              selected = primary;
            }
          } else {
            logger?.info('No GTID context found, skipping to replica');
          }
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
export const createVirtualPool = (options: VirtualPoolOptions): Pool => {
  const primary = createPool(options.primary);

  if (includesMode(options.mode, GTID_CONTEXT_ENABLED_MODE)) {
    // track session ids so they are returned on writes
    primary.on('connection', async (conn) => {
      await conn.query('SET SESSION session_track_gtids = OWN_GTID');
    });
  }

  const replicas = options.replicas.map((replicaConfig) =>
    createPool(replicaConfig),
  );

  return createPoolProxy({
    ...options,
    primary,
    replicas,
  });
};

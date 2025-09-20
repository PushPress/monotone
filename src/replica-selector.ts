import { Pool, RowDataPacket } from 'mysql2/promise';
import { Logger } from './logger';
import { GTIDProvider } from './monotone';

type WaitRow = RowDataPacket & { waited: number };

type GTIDRow = RowDataPacket & { gtid: string };

/** Configuration options for GTID replica selector */
interface ReplicaSelectorOptions {
  /** seconds to wait for GTID to be replicated */
  timeout?: number;
  logger?: Logger;
}

/**
 * Selects appropriate database connection pools using GTID-based synchronization checks.
 * Ensures read operations use replicas that have caught up with the primary.
 */
export class GTIDReplicaSelector {
  private primary: Pool;
  private gtidProvider: GTIDProvider;
  private replicas: Pool[];
  private options?: ReplicaSelectorOptions;
  /**
   * Creates a new GTID replica selector instance.
   * @param primary - Primary database connection pool
   * @param replicas - Array of replica database connection pools
   * @param options - Optional configuration settings
   */
  constructor({
    primary,
    replicas,
    options,
    gtidProvider,
  }: {
    primary: Pool;
    replicas: Pool[];
    gtidProvider: GTIDProvider;
    options?: ReplicaSelectorOptions;
  }) {
    this.gtidProvider = gtidProvider;
    this.primary = primary;
    this.replicas = replicas;
    this.options = options;
  }

  /**
   * Retrieves the current GTID from the primary database.
   * @returns The executed GTID string from the primary, or undefined if not available
   */
  private async getGTID(): Promise<string | undefined> {
    try {
      return await this.gtidProvider.getGTID();
    } catch (error) {
      this.options?.logger?.error(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to retrieve GTID from primary database',
      );
      return undefined;
    }
  }

  /**
   * Captures the current GTID from the primary database and notifies the GTID provider.
   * Only captures GTID if the application has provided an onWriteComplete callback,
   * indicating they want to control GTID storage.
   */
  async captureGTID(): Promise<void> {
    try {
      const [gtidRows] = await this.primary.query<GTIDRow[]>(
        'SELECT @@GLOBAL.GTID_EXECUTED as gtid',
      );

      if (gtidRows && gtidRows.length > 0 && gtidRows[0]?.gtid) {
        await this.gtidProvider.onWriteGTID?.(gtidRows[0].gtid);
        this.options?.logger?.debug(
          {
            capturedGTID: gtidRows[0].gtid,
          },
          'GTID captured after write operation',
        );
      }
    } catch (error) {
      this.options?.logger?.warn(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to capture GTID after write operation',
      );
    }
  }

  /**
   * Waits for a replica to catch up with the primary GTID.
   * @param replica - The replica pool to check
   * @returns Wait result: 0 (success), 1 (timeout), -1 (error)
   */
  private async waitForGTID(replica: Pool) {
    const gtid = await this.getGTID();
    if (!gtid) {
      this.options?.logger?.warn(
        'No GTID available from primary, skipping sync check',
      );
      return;
    }

    this.options?.logger?.debug(
      {
        targetGTID: gtid,
        timeout: this.options?.timeout ?? 0.05,
      },
      'Waiting for replica GTID synchronization',
    );

    try {
      const [rows] = await replica.query<WaitRow[]>(
        `SELECT WAIT_FOR_EXECUTED_GTID_SET(?, ?) as waited`,
        [gtid, this.options?.timeout ?? 0.05],
      );

      if (!rows || rows.length === 0) {
        this.options?.logger?.error(
          {
            targetGTID: gtid,
          },
          'No result from GTID wait query',
        );
        return -1;
      }

      const row = rows[0];
      if (!row || typeof row.waited !== 'number') {
        this.options?.logger?.error(
          {
            waited: row?.waited,
            waitedType: typeof row?.waited,
            targetGTID: gtid,
          },
          'Invalid wait result from replica',
        );
        return -1;
      }

      this.options?.logger?.debug(
        {
          waitResult: row.waited,
          targetGTID: gtid,
        },
        'GTID wait completed',
      );

      return row.waited;
    } catch (error) {
      this.options?.logger?.error(
        {
          error: error instanceof Error ? error.message : String(error),
          targetGTID: gtid,
        },
        'GTID wait query failed',
      );
      return -1;
    }
  }

  /**
   * Selects the appropriate database pool for read operations.
   * Returns a replica if it's synchronized, otherwise falls back to primary.
   * @returns Database connection pool (replica or primary)
   */
  async selectPool() {
    const [selectedReplica] = this.replicas;

    if (!selectedReplica) {
      this.options?.logger?.warn(
        {
          replicaCount: this.replicas.length,
          fallbackReason: 'no_replicas',
        },
        'No replicas available, using primary',
      );
      return this.primary;
    }

    this.options?.logger?.debug(
      {
        replicaIndex: 0,
        timeout: this.options?.timeout ?? 0.05,
      },
      'Checking replica synchronization',
    );

    const res = await this.waitForGTID(selectedReplica);

    // Handle undefined result (GTID unavailable)
    if (res === undefined) {
      this.options?.logger?.warn(
        {
          selection: 'primary',
          fallbackReason: 'gtid_unavailable',
        },
        'GTID unavailable, falling back to primary',
      );
      return this.primary;
    }

    const logger = this.options?.logger?.child({});

    switch (res) {
      case 0:
        logger?.debug(
          {
            selection: 'replica',
          },
          'Replica synchronized, routing to replica',
        );
        return selectedReplica;
      case 1:
        logger?.warn(
          {
            timeout: this.options?.timeout ?? 0.05,
            selection: 'primary',
            fallbackReason: 'sync_timeout',
          },
          'Replica sync timeout, falling back to primary',
        );
        return this.primary;
      case -1:
        logger?.error(
          {
            selection: 'primary',
            fallbackReason: 'sync_error',
          },
          'Replica sync error, falling back to primary',
        );
        return this.primary;
      default:
        logger?.error(
          {
            waitResult: res,
            selection: 'primary',
            fallbackReason: 'unknown_result',
          },
          'Unknown GTID wait result, falling back to primary',
        );
        return this.primary;
    }
  }
}

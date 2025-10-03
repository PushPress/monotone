import { Pool, RowDataPacket } from 'mysql2/promise';
import { Logger } from './logger';

interface WaitResult extends RowDataPacket {
  wait_code: 0 | 1 | null; // the only possible values
}

const SUCCESS = 0;
const TIMEOUT = 1;
const ERROR = 2;
type Success = typeof SUCCESS;
type Timeout = typeof TIMEOUT;
type Error = typeof ERROR;

type WaitForReplicationResult = Timeout | Success | Error;

type WaitForReplicationOptions = {
  /** milliseconds to wait for replication at most */
  timeout: number;
  logger?: Logger;
};

export function isSuccessfulReplication(result: WaitForReplicationResult) {
  return result === SUCCESS;
}

export async function waitForReplication(
  pool: Pool,
  {
    gtidSet,
  }: {
    gtidSet: string;
  },
  { logger, timeout }: WaitForReplicationOptions,
): Promise<WaitForReplicationResult> {
  const [[row]] = await pool.query<WaitResult[]>(
    'SELECT WAIT_UNTIL_SQL_THREAD_AFTER_GTIDS(?, ?)',
    [gtidSet, timeout / 1000],
  );

  switch (row?.wait_code) {
    case SUCCESS:
      logger?.debug({ gtidSet }, 'GTID replication complete');
      return SUCCESS;
    case TIMEOUT:
      logger?.warn({ gtidSet }, 'Timeout waiting for GTID replication');
      return TIMEOUT;
    default:
      logger?.error(
        { gtidSet },
        'Something went wrong waiting for GTID replication. check replication settings',
      );
      return ERROR;
  }
}

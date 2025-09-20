import { GTIDProvider } from '../monotone';

/**
 * Map-based implementation of GTIDProvider that stores GTIDs in a Map.
 *
 * This implementation stores GTIDs using keys in the format "db.table" where:
 * - db: database name
 * - table: table name
 *
 * The GTID value represents the last known GTID for that specific database.table combination.
 *
 * @example
 * ```typescript
 * // Basic usage
 * const gtidProvider = new MapGTIDProvider();
 *
 * // Store GTID for specific table
 * await gtidProvider.onWriteGTID('12345-67890', ['mydb.users']);
 *
 * // Retrieve GTID for specific table
 * const gtid = await gtidProvider.getGTID(['mydb.users']);
 * console.log(gtid); // '12345-67890'
 * ```
 */
export class MapGTIDProvider implements GTIDProvider {
  private gtidMap: Map<string, string> = new Map();

  constructor() {
  }

  /**
   * Retrieves the current GTID for replica synchronization checks.
   * 
   * @param affectedTables - Optional array of table names in "db.table" format.
   *                        If provided, returns the GTID for the first matching table.
   *                        If not provided or no match found, returns undefined.
   * @returns The GTID string for the specified table, or undefined if not found.
   */
  async getGTID(affectedTables?: string[]): Promise<string | undefined> {
    // If no tables specified, return undefined
    if (!affectedTables || affectedTables.length === 0) {
      return undefined;
    }

    // Return the GTID for the first matching table
    for (const table of affectedTables) {
      const gtid = this.gtidMap.get(table);
      if (gtid) {
        return gtid;
      }
    }

    // No GTID found in map
    return undefined;
  }

  /**
   * Stores the GTID in the in-memory map for the affected tables.
   *
   * @param gtid - The GTID string to store
   * @param affectedTables - Optional array of table names in "db.table" format.
   *                        If provided, stores the GTID for each table.
   *                        If not provided, no GTID is stored.
   */
  async onWriteGTID(gtid: string, affectedTables?: string[]): Promise<void> {
    if (!affectedTables || affectedTables.length === 0) {
      return;
    }

    // Store the GTID for each affected table
    for (const table of affectedTables) {
      this.gtidMap.set(table, gtid);
    }
  }

  /**
   * Gets all stored GTIDs for debugging or inspection purposes.
   *
   * @returns A copy of the internal GTID map
   */
  getAllGTIDs(): Map<string, string> {
    return new Map(this.gtidMap);
  }

  /**
   * Clears all stored GTIDs.
   * Useful for testing or resetting state.
   */
  clear(): void {
    this.gtidMap.clear();
  }

  /**
   * Gets the number of stored GTID entries.
   *
   * @returns The number of entries in the GTID map
   */
  size(): number {
    return this.gtidMap.size;
  }

  /**
   * Sets a default GTID for all tables. Useful for server startup
   * when you want to start with a known GTID state.
   *
   * @param gtid - The GTID to set as default
   * @param tables - Array of table names in "db.table" format
   */
  setDefaultGTID(gtid: string, tables: string[]): void {
    for (const table of tables) {
      this.gtidMap.set(table, gtid);
    }
  }
}


import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMonotonePool } from '../src/monotone';

// Simple mock that focuses on behavior, not implementation
class SimplePoolMock {
  public query = vi.fn();
  public execute = vi.fn();
  public getConnection = vi.fn();
  public releaseConnection = vi.fn();
  public end = vi.fn();

  constructor() {
    this.query.mockResolvedValue([[], {}]);
    this.execute.mockResolvedValue([[], {}]);
    this.getConnection.mockResolvedValue({});
    this.releaseConnection.mockResolvedValue(undefined);
    this.end.mockResolvedValue(undefined);
  }

  mockSuccess(data: any[] = []) {
    this.query.mockResolvedValue([data, {}]);
    return this;
  }

  mockError(error: Error) {
    this.query.mockRejectedValue(error);
    return this;
  }
}

// Mock mysql2/promise at the module level
vi.mock('mysql2/promise', () => ({
  createPool: vi.fn(),
}));

describe('createMonotonePool - Behavior Focused Tests', () => {
  let mockPrimary: SimplePoolMock;
  let mockReplica: SimplePoolMock;
  let mockCreatePool: any;

  beforeEach(async () => {
    mockPrimary = new SimplePoolMock();
    mockReplica = new SimplePoolMock();

    // Get the mocked createPool function
    const mysql2 = await import('mysql2/promise');
    mockCreatePool = vi.mocked(mysql2.createPool);

    // Set up the mock to return our mock pools
    mockCreatePool.mockImplementation((config: any) => {
      if (config.host === 'primary') {
        return mockPrimary;
      }
      return mockReplica;
    });
  });

  describe('pool creation', () => {
    it('should create a monotone pool', () => {
      const config = {
        primary: {
          host: 'primary',
          user: 'user',
          password: 'pass',
          database: 'test',
        },
        replicas: [
          { host: 'replica', user: 'user', password: 'pass', database: 'test' },
        ],
        gtidProvider: {
          async getGTID() {
            return 'test-gtid';
          },
          async onWriteGTID() {},
        },
      };

      const pool = createMonotonePool(config);

      expect(pool).toBeDefined();
      expect(typeof pool.query).toBe('function');
    });

    it('should route reads to replica without GTID logic when disabled', async () => {
      const config = {
        primary: {
          host: 'primary',
          user: 'user',
          password: 'pass',
          database: 'test',
        },
        replicas: [
          { host: 'replica', user: 'user', password: 'pass', database: 'test' },
        ],
        gtidProvider: {
          async getGTID() {
            return 'test-gtid';
          },
          async onWriteGTID() {},
        },
        disabled: true,
      };

      const pool = createMonotonePool(config);
      mockReplica.mockSuccess([{ id: 1, name: 'John' }]);

      // Read query should go to replica without GTID synchronization
      const result = await pool.query('SELECT * FROM users');
      
      expect(mockReplica.query).toHaveBeenCalledWith('SELECT * FROM users');
      expect(mockPrimary.query).not.toHaveBeenCalled();
      expect(result).toEqual([[{ id: 1, name: 'John' }], {}]);
    });

    it('should still route write queries to primary when disabled', async () => {
      const config = {
        primary: {
          host: 'primary',
          user: 'user',
          password: 'pass',
          database: 'test',
        },
        replicas: [
          { host: 'replica', user: 'user', password: 'pass', database: 'test' },
        ],
        gtidProvider: {
          async getGTID() {
            return 'test-gtid';
          },
          async onWriteGTID() {},
        },
        disabled: true,
      };

      const pool = createMonotonePool(config);
      mockPrimary.mockSuccess();

      // Write query should still go to primary
      await pool.query('INSERT INTO users (name) VALUES (?)', ['John']);
      
      expect(mockPrimary.query).toHaveBeenCalledWith(
        'INSERT INTO users (name) VALUES (?)',
        ['John']
      );
      expect(mockReplica.query).not.toHaveBeenCalled();
    });
  });

  describe('write query routing', () => {
    it('should route write queries to primary', async () => {
      const config = {
        primary: {
          host: 'primary',
          user: 'user',
          password: 'pass',
          database: 'test',
        },
        replicas: [
          { host: 'replica', user: 'user', password: 'pass', database: 'test' },
        ],
        gtidProvider: {
          async getGTID() {
            return 'test-gtid';
          },
          async onWriteGTID() {},
        },
      };

      const pool = createMonotonePool(config);
      mockPrimary.mockSuccess();

      await pool.query('INSERT INTO users (name) VALUES (?)', ['John']);

      expect(mockPrimary.query).toHaveBeenCalledWith(
        'INSERT INTO users (name) VALUES (?)',
        ['John'],
      );
      expect(mockReplica.query).not.toHaveBeenCalled();
    });

    it('should detect various write operations', async () => {
      const writeQueries = [
        'INSERT INTO users (name) VALUES (?)',
        'UPDATE users SET name = ? WHERE id = ?',
        'DELETE FROM users WHERE id = ?',
        'CREATE TABLE test (id INT)',
        'DROP TABLE test',
      ];

      const config = {
        primary: {
          host: 'primary',
          user: 'user',
          password: 'pass',
          database: 'test',
        },
        replicas: [
          { host: 'replica', user: 'user', password: 'pass', database: 'test' },
        ],
        gtidProvider: {
          async getGTID() {
            return 'test-gtid';
          },
          async onWriteGTID() {},
        },
      };

      const pool = createMonotonePool(config);

      for (const sql of writeQueries) {
        mockPrimary.mockSuccess();
        await pool.query(sql);
        expect(mockPrimary.query).toHaveBeenCalledWith(sql);
        mockPrimary.query.mockClear();
      }
    });
  });

  describe('read query routing', () => {
    it('should route read queries to replica when available', async () => {
      const config = {
        primary: {
          host: 'primary',
          user: 'user',
          password: 'pass',
          database: 'test',
        },
        replicas: [
          { host: 'replica', user: 'user', password: 'pass', database: 'test' },
        ],
        gtidProvider: {
          async getGTID() {
            return 'test-gtid';
          },
          async onWriteGTID() {},
        },
      };

      const pool = createMonotonePool(config);

      // Mock successful GTID wait and query
      mockReplica.query.mockImplementation((sql: string) => {
        if (sql.includes('WAIT_FOR_EXECUTED_GTID_SET')) {
          return Promise.resolve([[{ waited: 0 }], {}]);
        }
        return Promise.resolve([[{ id: 1, name: 'John' }], {}]);
      });

      const result = await pool.query('SELECT * FROM users');

      expect(mockReplica.query).toHaveBeenCalledTimes(2);
      expect(mockPrimary.query).not.toHaveBeenCalled();
      expect(result).toEqual([[{ id: 1, name: 'John' }], {}]);
    });

    it('should fallback to primary when no replicas available', async () => {
      const config = {
        primary: {
          host: 'primary',
          user: 'user',
          password: 'pass',
          database: 'test',
        },
        replicas: [],
        gtidProvider: {
          async getGTID() {
            return 'test-gtid';
          },
          async onWriteGTID() {},
        },
      };

      const pool = createMonotonePool(config);
      mockPrimary.mockSuccess([{ id: 1, name: 'John' }]);

      const result = await pool.query('SELECT * FROM users');

      expect(mockPrimary.query).toHaveBeenCalledWith('SELECT * FROM users');
      expect(mockReplica.query).not.toHaveBeenCalled();
      expect(result).toEqual([[{ id: 1, name: 'John' }], {}]);
    });

    it('should fallback to primary when replica fails', async () => {
      const config = {
        primary: {
          host: 'primary',
          user: 'user',
          password: 'pass',
          database: 'test',
        },
        replicas: [
          { host: 'replica', user: 'user', password: 'pass', database: 'test' },
        ],
        gtidProvider: {
          async getGTID() {
            return 'test-gtid';
          },
          async onWriteGTID() {},
        },
      };

      const pool = createMonotonePool(config);

      // Mock replica failure
      mockReplica.query.mockImplementation((sql: string) => {
        if (sql.includes('WAIT_FOR_EXECUTED_GTID_SET')) {
          return Promise.resolve([[{ waited: -1 }], {}]); // Error
        }
        return Promise.resolve([[], {}]);
      });

      mockPrimary.mockSuccess([{ id: 1, name: 'John' }]);

      const result = await pool.query('SELECT * FROM users');

      expect(mockPrimary.query).toHaveBeenCalledWith('SELECT * FROM users');
      expect(mockReplica.query).toHaveBeenCalledTimes(1); // Only GTID wait attempt
      expect(result).toEqual([[{ id: 1, name: 'John' }], {}]);
    });
  });

  describe('GTID provider integration', () => {
    it('should call GTID provider for read queries', async () => {
      const mockGTIDProvider = {
        getGTID: vi.fn().mockResolvedValue('test-gtid'),
        onWriteGTID: vi.fn().mockResolvedValue(undefined),
      };

      const config = {
        primary: {
          host: 'primary',
          user: 'user',
          password: 'pass',
          database: 'test',
        },
        replicas: [
          { host: 'replica', user: 'user', password: 'pass', database: 'test' },
        ],
        gtidProvider: mockGTIDProvider,
      };

      const pool = createMonotonePool(config);

      // Mock successful replica response
      mockReplica.query.mockImplementation((sql: string) => {
        if (sql.includes('WAIT_FOR_EXECUTED_GTID_SET')) {
          return Promise.resolve([[{ waited: 0 }], {}]);
        }
        return Promise.resolve([[{ id: 1 }], {}]);
      });

      await pool.query('SELECT * FROM users');

      expect(mockGTIDProvider.getGTID).toHaveBeenCalled();
    });

    it('should call onWriteGTID after write operations', async () => {
      const mockGTIDProvider = {
        getGTID: vi.fn().mockResolvedValue('test-gtid'),
        onWriteGTID: vi.fn().mockResolvedValue(undefined),
      };

      const config = {
        primary: {
          host: 'primary',
          user: 'user',
          password: 'pass',
          database: 'test',
        },
        replicas: [
          { host: 'replica', user: 'user', password: 'pass', database: 'test' },
        ],
        gtidProvider: mockGTIDProvider,
      };

      const pool = createMonotonePool(config);

      // Mock GTID capture
      mockPrimary.query.mockImplementation((sql: string) => {
        if (sql.includes('SELECT @@GLOBAL.GTID_EXECUTED')) {
          return Promise.resolve([[{ gtid: 'new-gtid-123' }], {}]);
        }
        return Promise.resolve([[], {}]);
      });

      await pool.query('INSERT INTO users (name) VALUES (?)', ['John']);

      expect(mockGTIDProvider.onWriteGTID).toHaveBeenCalledWith('new-gtid-123');
    });
  });
});


import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GTIDReplicaSelector } from '../src/replica-selector';

// Simple mock pool for testing
class SimpleMockPool {
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

describe('GTIDReplicaSelector', () => {
  let mockPrimary: SimpleMockPool;
  let mockReplica: SimpleMockPool;
  let selector: GTIDReplicaSelector;
  beforeEach(() => {
    mockPrimary = new SimpleMockPool();
    mockReplica = new SimpleMockPool();

    selector = new GTIDReplicaSelector({
      primary: mockPrimary as any,
      replicas: [mockReplica as any],
      options: {
        timeout: 0.1,
        logger: {
          debug: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          child: vi.fn(() => ({
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn()
          }))
        } as any
      }
    });
  });

  describe('pool selection behavior', () => {
    it('should select replica when GTID sync succeeds', async () => {
      // Mock primary GTID retrieval
      mockPrimary.query.mockImplementation((sql: string) => {
        if (sql.includes('GTID_EXECUTED')) {
          return Promise.resolve([[{ gtid: 'test-gtid-123' }], {}]);
        }
        return Promise.resolve([[], {}]);
      });
      
      // Mock successful GTID wait
      mockReplica.mockSuccess([{ waited: 0 }]);

      const selectedPool = await selector.selectPool();

      expect(selectedPool).toBe(mockReplica);
      expect(mockReplica.query).toHaveBeenCalledWith(
        expect.stringContaining('WAIT_FOR_EXECUTED_GTID_SET'),
        expect.arrayContaining(['test-gtid-123', 0.1])
      );
    });

    it('should fallback to primary when replica sync times out', async () => {
      // Mock primary GTID retrieval
      mockPrimary.query.mockImplementation((sql: string) => {
        if (sql.includes('GTID_EXECUTED')) {
          return Promise.resolve([[{ gtid: 'test-gtid-123' }], {}]);
        }
        return Promise.resolve([[], {}]);
      });
      
      // Mock timeout response
      mockReplica.mockSuccess([{ waited: 1 }]);

      const selectedPool = await selector.selectPool();

      expect(selectedPool).toBe(mockPrimary);
    });

    it('should fallback to primary when replica sync fails', async () => {
      // Mock primary GTID retrieval
      mockPrimary.query.mockImplementation((sql: string) => {
        if (sql.includes('GTID_EXECUTED')) {
          return Promise.resolve([[{ gtid: 'test-gtid-123' }], {}]);
        }
        return Promise.resolve([[], {}]);
      });
      
      // Mock error response
      mockReplica.mockSuccess([{ waited: -1 }]);

      const selectedPool = await selector.selectPool();

      expect(selectedPool).toBe(mockPrimary);
    });

    it('should fallback to primary when no replicas available', async () => {
      const selectorNoReplicas = new GTIDReplicaSelector({
        primary: mockPrimary as any,
        replicas: [],
        options: {
          timeout: 0.1,
          logger: {
            warn: vi.fn(),
            debug: vi.fn(),
            error: vi.fn(),
            child: vi.fn(() => ({
              debug: vi.fn(),
              warn: vi.fn(),
              error: vi.fn()
            }))
          } as any
        }
      });

      const selectedPool = await selectorNoReplicas.selectPool();

      expect(selectedPool).toBe(mockPrimary);
    });

    it('should fallback to primary when GTID is unavailable', async () => {
      // Mock primary GTID retrieval to return undefined
      mockPrimary.query.mockImplementation((sql: string) => {
        if (sql.includes('GTID_EXECUTED')) {
          return Promise.resolve([[{ gtid: undefined }], {}]);
        }
        return Promise.resolve([[], {}]);
      });

      const selectedPool = await selector.selectPool();

      expect(selectedPool).toBe(mockPrimary);
    });

    it('should fallback to primary when GTID retrieval throws error', async () => {
      // Mock primary GTID retrieval to throw error
      mockPrimary.query.mockImplementation((sql: string) => {
        if (sql.includes('GTID_EXECUTED')) {
          return Promise.reject(new Error('GTID retrieval error'));
        }
        return Promise.resolve([[], {}]);
      });

      const selectedPool = await selector.selectPool();

      expect(selectedPool).toBe(mockPrimary);
    });
  });


  describe('timeout configuration', () => {
    it('should use default timeout when not specified', async () => {
      const selectorDefaultTimeout = new GTIDReplicaSelector({
        primary: mockPrimary as any,
        replicas: [mockReplica as any],
        options: {
          logger: {
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            child: vi.fn(() => ({
              debug: vi.fn(),
              warn: vi.fn(),
              error: vi.fn()
            }))
          } as any
        }
      });

      // Mock primary GTID retrieval
      mockPrimary.query.mockImplementation((sql: string) => {
        if (sql.includes('GTID_EXECUTED')) {
          return Promise.resolve([[{ gtid: 'test-gtid-123' }], {}]);
        }
        return Promise.resolve([[], {}]);
      });

      mockReplica.mockSuccess([{ waited: 0 }]);

      await selectorDefaultTimeout.selectPool();

      expect(mockReplica.query).toHaveBeenCalledWith(
        expect.stringContaining('WAIT_FOR_EXECUTED_GTID_SET'),
        expect.arrayContaining(['test-gtid-123', 0.05]) // Default timeout
      );
    });

    it('should use custom timeout when specified', async () => {
      const customTimeout = 0.5;
      const selectorCustomTimeout = new GTIDReplicaSelector({
        primary: mockPrimary as any,
        replicas: [mockReplica as any],
        options: {
          timeout: customTimeout,
          logger: {
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            child: vi.fn(() => ({
              debug: vi.fn(),
              warn: vi.fn(),
              error: vi.fn()
            }))
          } as any
        }
      });

      // Mock primary GTID retrieval
      mockPrimary.query.mockImplementation((sql: string) => {
        if (sql.includes('GTID_EXECUTED')) {
          return Promise.resolve([[{ gtid: 'test-gtid-123' }], {}]);
        }
        return Promise.resolve([[], {}]);
      });

      mockReplica.mockSuccess([{ waited: 0 }]);

      await selectorCustomTimeout.selectPool();

      expect(mockReplica.query).toHaveBeenCalledWith(
        expect.stringContaining('WAIT_FOR_EXECUTED_GTID_SET'),
        expect.arrayContaining(['test-gtid-123', customTimeout])
      );
    });
  });
});
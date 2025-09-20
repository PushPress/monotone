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
  let mockGTIDProvider: any;

  beforeEach(() => {
    mockPrimary = new SimpleMockPool();
    mockReplica = new SimpleMockPool();
    
    mockGTIDProvider = {
      getGTID: vi.fn().mockResolvedValue('test-gtid-123'),
      onWriteGTID: vi.fn().mockResolvedValue(undefined)
    };

    selector = new GTIDReplicaSelector({
      primary: mockPrimary as any,
      replicas: [mockReplica as any],
      gtidProvider: mockGTIDProvider,
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
      // Mock timeout response
      mockReplica.mockSuccess([{ waited: 1 }]);

      const selectedPool = await selector.selectPool();

      expect(selectedPool).toBe(mockPrimary);
    });

    it('should fallback to primary when replica sync fails', async () => {
      // Mock error response
      mockReplica.mockSuccess([{ waited: -1 }]);

      const selectedPool = await selector.selectPool();

      expect(selectedPool).toBe(mockPrimary);
    });

    it('should fallback to primary when no replicas available', async () => {
      const selectorNoReplicas = new GTIDReplicaSelector({
        primary: mockPrimary as any,
        replicas: [],
        gtidProvider: mockGTIDProvider,
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
      mockGTIDProvider.getGTID.mockResolvedValue(undefined);

      const selectedPool = await selector.selectPool();

      expect(selectedPool).toBe(mockPrimary);
    });

    it('should fallback to primary when GTID provider throws error', async () => {
      mockGTIDProvider.getGTID.mockRejectedValue(new Error('GTID provider error'));

      const selectedPool = await selector.selectPool();

      expect(selectedPool).toBe(mockPrimary);
    });
  });

  describe('GTID capture behavior', () => {
    it('should capture GTID after write operation', async () => {
      mockPrimary.mockSuccess([{ gtid: 'new-gtid-456' }]);

      await selector.captureGTID();

      expect(mockPrimary.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT @@GLOBAL.GTID_EXECUTED')
      );
      expect(mockGTIDProvider.onWriteGTID).toHaveBeenCalledWith('new-gtid-456');
    });

    it('should handle GTID capture when no GTID available', async () => {
      mockPrimary.mockSuccess([]);

      await selector.captureGTID();

      expect(mockPrimary.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT @@GLOBAL.GTID_EXECUTED')
      );
      expect(mockGTIDProvider.onWriteGTID).not.toHaveBeenCalled();
    });

    it('should handle GTID capture error gracefully', async () => {
      mockPrimary.mockError(new Error('Database error'));

      await expect(selector.captureGTID()).resolves.not.toThrow();

      expect(mockGTIDProvider.onWriteGTID).not.toHaveBeenCalled();
    });

    it('should not call onWriteGTID when not provided', async () => {
      const gtidProviderWithoutCallback = {
        getGTID: vi.fn().mockResolvedValue('test-gtid')
        // No onWriteGTID method
      };

      const selectorWithoutCallback = new GTIDReplicaSelector({
        primary: mockPrimary as any,
        replicas: [mockReplica as any],
        gtidProvider: gtidProviderWithoutCallback,
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

      mockPrimary.mockSuccess([{ gtid: 'new-gtid-789' }]);

      await selectorWithoutCallback.captureGTID();

      expect(mockPrimary.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT @@GLOBAL.GTID_EXECUTED')
      );
      // Should not throw error even though onWriteGTID is undefined
    });
  });

  describe('timeout configuration', () => {
    it('should use default timeout when not specified', async () => {
      const selectorDefaultTimeout = new GTIDReplicaSelector({
        primary: mockPrimary as any,
        replicas: [mockReplica as any],
        gtidProvider: mockGTIDProvider,
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
        gtidProvider: mockGTIDProvider,
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

      mockReplica.mockSuccess([{ waited: 0 }]);

      await selectorCustomTimeout.selectPool();

      expect(mockReplica.query).toHaveBeenCalledWith(
        expect.stringContaining('WAIT_FOR_EXECUTED_GTID_SET'),
        expect.arrayContaining(['test-gtid-123', customTimeout])
      );
    });
  });
});
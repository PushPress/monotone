import { describe, it, expect, beforeEach } from 'vitest';
import { init, read, set, GTIDContext } from '../src/gtid-context';

describe('GTID Context', () => {
  beforeEach(() => {
    init(`test-isolation-${Date.now()}-${Math.random()}`);
  });

  describe('Basic functionality', () => {
    it('should create and read a GTID context', () => {
      const testGtid = 'test-gtid-123';
      init(testGtid);
      const context = read();

      expect(context).toBeDefined();
      expect(context?.gtid).toBe(testGtid);
    });

    it('should return undefined when no context is set', async () => {
      const { AsyncLocalStorage } = await import('node:async_hooks');
      const freshStorage = new AsyncLocalStorage<GTIDContext>();
      const context = freshStorage.getStore();
      expect(context).toBeUndefined();
    });
  });

  describe('Async context persistence', () => {
    it('should maintain GTID context through async operations', async () => {
      const testGtid = 'async-gtid';
      init(testGtid);

      const asyncOperation = async () => {
        await Promise.resolve();
        const context = read();
        expect(context?.gtid).toBe(testGtid);
      };

      await asyncOperation();

      const context = read();
      expect(context?.gtid).toBe(testGtid);
    });

    it('should maintain GTID context through error handling', async () => {
      const testGtid = 'error-gtid';
      init(testGtid);

      await Promise.resolve()
        .then(() => {
          const context = read();
          expect(context?.gtid).toBe(testGtid);
          throw new Error('Test error');
        })
        .catch((error) => {
          const context = read();
          expect(context?.gtid).toBe(testGtid);
          expect(error.message).toBe('Test error');
        });

      const context = read();
      expect(context?.gtid).toBe(testGtid);
    });
  });

  describe('Context isolation', () => {
    it('should isolate GTID contexts between different init calls', () => {
      const gtid1 = 'context-1';
      const gtid2 = 'context-2';

      init(gtid1);
      let context = read();
      expect(context?.gtid).toBe(gtid1);

      init(gtid2);
      context = read();
      expect(context?.gtid).toBe(gtid2);
      expect(context?.gtid).not.toBe(gtid1);
    });

    it('should maintain separate contexts in parallel async operations', async () => {
      const gtid1 = 'parallel-context-1';
      const gtid2 = 'parallel-context-2';

      const operation1 = async () => {
        init(gtid1);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const context = read();
        expect(context?.gtid).toBe(gtid1);
      };

      const operation2 = async () => {
        init(gtid2);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const context = read();
        expect(context?.gtid).toBe(gtid2);
      };

      await Promise.all([operation1(), operation2()]);
    });
  });

  describe('Write-then-read scenarios', () => {
    it('should maintain GTID context for write-read cycles', async () => {
      const testGtid = 'write-read-gtid';
      init(testGtid);

      const writeOperation = async () => {
        await Promise.resolve();
        const context = read();
        expect(context?.gtid).toBe(testGtid);
      };

      const readOperation = async () => {
        const context = read();
        expect(context?.gtid).toBe(testGtid);
      };

      await writeOperation();
      await readOperation();
    });

    it('should maintain GTID context through nested async operations', async () => {
      const testGtid = 'nested-gtid';
      init(testGtid);

      const outerOperation = async () => {
        const innerOperation = async () => {
          await Promise.resolve();
          const context = read();
          expect(context?.gtid).toBe(testGtid);
        };

        await innerOperation();

        const context = read();
        expect(context?.gtid).toBe(testGtid);
      };

      await outerOperation();

      const finalContext = read();
      expect(finalContext?.gtid).toBe(testGtid);
    });
  });

  describe('Context mutation and sharing', () => {
    it('should allow context mutation and sharing between sibling async contexts', async () => {
      const requestGtid = 'request-gtid-123';
      init(requestGtid);

      const context = read();
      expect(context?.gtid).toBe(requestGtid);

      const siblingOperation1 = async () => {
        const context = read();
        expect(context?.gtid).toBe(requestGtid);

        set('updated-gtid-456');

        const updatedContext = read();
        expect(updatedContext?.gtid).toBe('updated-gtid-456');
      };

      const siblingOperation2 = async () => {
        const context = read();
        expect(context?.gtid).toBe('updated-gtid-456');

        set('final-gtid-789');

        const finalContext = read();
        expect(finalContext?.gtid).toBe('final-gtid-789');
      };

      await Promise.all([siblingOperation1(), siblingOperation2()]);

      const finalContext = read();
      expect(finalContext?.gtid).toBe('final-gtid-789');
    });

    it('should maintain context mutations across sequential async operations', async () => {
      const requestGtid = 'sequential-request-gtid';
      init(requestGtid);

      const operation1 = async () => {
        const context = read();
        expect(context?.gtid).toBe(requestGtid);

        set('operation1-gtid');

        const updatedContext = read();
        expect(updatedContext?.gtid).toBe('operation1-gtid');
      };

      const operation2 = async () => {
        const context = read();
        expect(context?.gtid).toBe('operation1-gtid');
      };

      await operation1();
      await operation2();
    });
  });
});

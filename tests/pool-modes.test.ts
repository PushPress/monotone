import { describe, it, expect } from 'vitest';
import {
  includesMode,
  DISABLED_MODE,
  REPLICA_SELECTION_MODE,
  GTID_CONTEXT_ENABLED_MODE,
  MODES,
} from '../src/pool-modes';

describe('Pool Modes', () => {
  describe('includesMode', () => {
    it('should return true when mode equals target mode', () => {
      expect(includesMode(DISABLED_MODE, DISABLED_MODE)).toBe(true);
      expect(includesMode(REPLICA_SELECTION_MODE, REPLICA_SELECTION_MODE)).toBe(
        true,
      );
      expect(
        includesMode(GTID_CONTEXT_ENABLED_MODE, GTID_CONTEXT_ENABLED_MODE),
      ).toBe(true);
    });

    it('should return true when mode is higher than target mode', () => {
      expect(includesMode(REPLICA_SELECTION_MODE, DISABLED_MODE)).toBe(true);
      expect(includesMode(GTID_CONTEXT_ENABLED_MODE, DISABLED_MODE)).toBe(true);
      expect(
        includesMode(GTID_CONTEXT_ENABLED_MODE, REPLICA_SELECTION_MODE),
      ).toBe(true);
    });

    it('should return false when mode is lower than target mode', () => {
      expect(includesMode(DISABLED_MODE, REPLICA_SELECTION_MODE)).toBe(false);
      expect(includesMode(DISABLED_MODE, GTID_CONTEXT_ENABLED_MODE)).toBe(
        false,
      );
      expect(
        includesMode(REPLICA_SELECTION_MODE, GTID_CONTEXT_ENABLED_MODE),
      ).toBe(false);
    });

    it('should work with all mode combinations', () => {
      MODES.forEach((mode, modeIndex) => {
        MODES.forEach((targetMode, targetIndex) => {
          const expected = modeIndex >= targetIndex;
          expect(includesMode(mode, targetMode)).toBe(expected);
        });
      });
    });
  });
});


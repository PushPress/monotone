/**
 * Pool modes
 * Modes are hierarchical, with the the gtid-context-enabled including replica selection
 */

export const DISABLED_MODE = 'disabled';
export const REPLICA_SELECTION_MODE = 'replica-selection';
export const GTID_CONTEXT_ENABLED_MODE = 'gtid-context-enabled';

export const MODES = [
  DISABLED_MODE,
  REPLICA_SELECTION_MODE,
  GTID_CONTEXT_ENABLED_MODE,
] as const;

export type ModeOrd = typeof MODES;

export type PoolMode = ModeOrd[number];

/**
 * Checks if a given mode includes the specified target mode.
 * Since modes are hierarchical, a mode includes all lower-level modes.
 *
 * @param mode - The mode to check
 * @param targetMode - The mode to check if it's included
 * @returns true if the mode includes the target mode, false otherwise
 */
export function includesMode(mode: PoolMode, targetMode: PoolMode): boolean {
  return MODES.indexOf(mode) >= MODES.indexOf(targetMode);
}

export function includesReplicaSelection(mode: PoolMode) {
  return includesMode(mode, REPLICA_SELECTION_MODE);
}

export function includesGtidContext(mode: PoolMode) {
  return includesMode(mode, GTID_CONTEXT_ENABLED_MODE);
}

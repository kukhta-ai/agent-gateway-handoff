// surfaces/cli · exit-code taxonomy (docs/05 §5).
// Stable and documented so agents branch on the coarse signal without parsing prose.
// The richer signal is the JSON `error.code`; the exit code is the coarse branch.

export const ExitCode = {
  /** success */
  OK: 0,
  /** unexpected / internal error */
  INTERNAL: 1,
  /** usage — invalid flags or arguments */
  USAGE: 2,
  /** admission / policy rejection (assembly not allowed) */
  POLICY: 3,
  /** authentication / authorization failure (insufficient capability) */
  AUTH: 4,
  /** not found */
  NOT_FOUND: 5,
  /** timeout / window expired */
  TIMEOUT: 6,
  /** conflict / invalid state transition */
  CONFLICT: 7,
  /** dependency / provider unavailable (cannot provision) */
  DEPENDENCY: 8,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

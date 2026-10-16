/**
 * Inputs the effective-config report could NOT read.
 *
 * Its own module because it is the report's honesty rail, not a step in building it: every port
 * the service reads is optional to the SHAPE of the report and load-bearing for its TRUTH.
 * Settings that fail to load fall back to `null`, which reads downstream as "nothing was
 * configured" — and provenance then stamps `scope:'default'` on every key, so the one screen a
 * person opens to ask "why isn't my setting applying" answers with pure defaults and calls them
 * effective. Silence is the worst possible answer there, so a failed read becomes a first-class
 * `error` diagnostic in the report it damaged.
 *
 * The recorder is also what provenance branches on: `failed(code)` is the machine-readable half
 * of the prose, so the two can never drift apart.
 */
import { errorMessage } from '../../lib/errors'
import type { ConfigDiagnostic } from './contracts'

export interface UnreadInputs {
  /**
   * Await `load`, or — if it rejects — record `diagnostic` as an `error` (with the cause
   * appended) and answer with `fallback`.
   *
   * A property (arrow) rather than a method: the implementation closes over the collector and
   * never touches `this`, and callers pass the extracted function around — a method signature
   * would make every such extraction an unbound-method hazard.
   */
  readOr: <T>(
    diagnostic: Omit<ConfigDiagnostic, 'severity'>,
    load: Promise<T>,
    fallback: T,
  ) => Promise<T>
  /** Record a failed read the caller detected itself (model resolution, which has its own shape). */
  note(diagnostic: ConfigDiagnostic): void
  /** Did the read behind this code actually fail? Provenance branches on this, not on the prose. */
  failed(code: string): boolean
  /** The diagnostics, in the order they were recorded. */
  list(): ConfigDiagnostic[]
}

export function createUnreadInputs(): UnreadInputs {
  const diagnostics: ConfigDiagnostic[] = []
  const failedCodes = new Set<string>()

  return {
    readOr: <T>(
      diagnostic: Omit<ConfigDiagnostic, 'severity'>,
      load: Promise<T>,
      fallback: T,
    ): Promise<T> =>
      load.catch((err: unknown) => {
        failedCodes.add(diagnostic.code)
        diagnostics.push({
          ...diagnostic,
          severity: 'error',
          message: `${diagnostic.message} (${errorMessage(err)})`,
        })
        return fallback
      }),
    note(diagnostic) {
      failedCodes.add(diagnostic.code)
      diagnostics.push(diagnostic)
    },
    failed: (code) => failedCodes.has(code),
    list: () => diagnostics,
  }
}

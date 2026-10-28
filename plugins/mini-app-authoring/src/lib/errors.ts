/** The message of anything thrown, for a report line. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A failure the person can act on: printed as is, without a stack. */
export class UserError extends Error {}

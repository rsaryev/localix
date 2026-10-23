/**
 * Should the Database sidebar replace the connection list with the new-connection form?
 *
 * The rule exists because "I have no connections" and "I couldn't ask" both arrive as an
 * empty array, and only the first one may open the form. Auto-opening it on a failed list
 * invites the user to retype credentials for connections that still exist — the one action
 * that turns a transient blip into a permanent duplicate.
 */
export function shouldShowConnectForm(args: {
  /** The user explicitly clicked "add" — always honoured, error or not. */
  adding: boolean
  /** The mount `list()` hasn't settled yet. An in-flight empty list is NOT "you have
   *  none" — auto-opening the form here flashed it on every mount for a user whose
   *  saved connections were still on the wire. */
  loading: boolean
  connectionCount: number
  /** Why the list is missing, when it is; `null` once the server has actually answered. Only its
   *  presence is read here — the reason belongs to whoever renders it. */
  listError: unknown
}): boolean {
  return args.adding || (!args.loading && args.connectionCount === 0 && args.listError == null)
}

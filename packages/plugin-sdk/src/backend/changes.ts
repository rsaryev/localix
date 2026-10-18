/**
 * CHANGE FEED — the host's one mechanism for "what changed", offered to a plugin for its own
 * items: the plugin records thin notices, and any number of its consumers read them, each at its
 * own durable cursor (a consumer that was down catches up on start). The core's chats, messages
 * and capabilities flow through the same mechanism; a plugin's stream is its own
 * (`plugin:<name>`), so it can neither read nor write another's.
 *
 * A notice names what changed, never its state: a consumer reads what it needs, so delivery at
 * least once is harmless. `upserted` is created-or-changed, `deleted` carries what cleanup
 * needs, `resync` says "anything of this kind may have changed — reconcile".
 */

export type PluginChange<Entity extends string = string> =
  | { entity: Entity; op: 'upserted' | 'deleted'; ref: Record<string, unknown> }
  | { entity: Entity; op: 'resync' }

/** The host capability a plugin backend receives as `host.changes`. */
export interface ChangeFeedHost {
  /**
   * Record changes to the plugin's stream. Fire-and-forget: never awaited, never thrown — a
   * notice that cannot be written is logged and left to the consumers' reconcile.
   */
  record(changes: PluginChange | readonly PluginChange[]): void
  /**
   * Read the plugin's stream as `consumer` (a name stable across restarts: it owns the cursor).
   * A handler that throws is retried with backoff from the same notice. A new consumer starts
   * past what is already recorded. Resolves with the stop once its cursor is placed.
   */
  subscribe(
    consumer: string,
    handler: (change: PluginChange) => Promise<void> | void,
  ): Promise<() => Promise<void>>
}

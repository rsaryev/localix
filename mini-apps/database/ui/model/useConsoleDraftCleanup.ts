import { useEffect } from 'react'
import { miniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime'
import { DB_CONSOLE_KIND } from './openConsole'
import { draftStoreKey } from './consoleDraft'

/**
 * Whether a grid id is an EXTRA console — `database:console:<connId>:<rand>`, minted per "New
 * console" click — as opposed to the primary `database:console:<connId>`, whose draft is a
 * DETERMINISTIC key that must survive close so reopening restores it.
 *
 * Counted on the part AFTER the kind, with the tab's `@<session>` suffix set aside: counting
 * colons over the whole id took the kind's own colon for a segment, so the primary console
 * (three segments) read as an extra and closing it deleted its saved draft.
 */
export function isExtraConsoleId(id: string): boolean {
  const prefix = `${DB_CONSOLE_KIND}:`
  if (!id.startsWith(prefix)) return false
  const at = id.lastIndexOf('@')
  const rest = id.slice(prefix.length, at > prefix.length ? at : undefined)
  return rest.includes(':')
}

/** The currently-open EXTRA-console WorkItem ids in the grid item registry. */
function extraConsoleIds(items: Record<string, unknown>): Set<string> {
  return new Set(Object.keys(items).filter(isExtraConsoleId))
}

/** Forget every persisted console draft owned by a connection after that saved
 * connection has actually been deleted. Primary SQL uses `db-console:<id>`, extra SQL
 * appends `:<random>`, while KV/document/search consoles use the bare connection id.
 * A console is a session tab, so its grid id — the draft's key — ends in `@<chat>`; matching
 * only the bare forms left every chat's primary-console draft behind a deleted connection. */
export function clearConnectionConsoleDrafts(connectionId: string, storage: Storage): void {
  const sqlPrefix = draftStoreKey(`${DB_CONSOLE_KIND}:${connectionId}`)
  const keys: string[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (key === sqlPrefix || key?.startsWith(`${sqlPrefix}:`) || key?.startsWith(`${sqlPrefix}@`))
      keys.push(key)
  }
  keys.push(draftStoreKey(connectionId))
  for (const key of new Set(keys)) storage.removeItem(key)
}

/**
 * Drops the persisted editor draft of an ADDITIONAL SQL console when its tab closes.
 * Extra consoles are keyed by a random per-open WorkItem id, so their
 * `db.console.draft.<id>` localStorage entries can never be reused — without this
 * sweep every "New console" open permanently accretes one orphaned entry (which may
 * contain sensitive SQL) after the tab (or its whole connection) is removed.
 * Mirrors the kubernetes mini app's `useForwardCleanup`: the grid item registry is the
 * close signal (a global-scope tab body unmounts on every tab switch, so unmount is
 * not reliable). Mounted once via the rail section's `Mount` lifecycle.
 */
export function useConsoleDraftCleanup(): void {
  useEffect(() => {
    let prev = extraConsoleIds(miniAppWorkspace.getSnapshot().items)
    return miniAppWorkspace.subscribe(() => {
      const next = extraConsoleIds(miniAppWorkspace.getSnapshot().items)
      if (next.size >= prev.size && [...prev].every((id) => next.has(id))) {
        prev = next
        return
      }
      const closed = [...prev].filter((id) => !next.has(id))
      prev = next
      for (const id of closed) {
        try {
          localStorage.removeItem(draftStoreKey(id))
        } catch {
          /* storage unavailable — cleanup is best-effort */
        }
      }
    })
  }, [])
}

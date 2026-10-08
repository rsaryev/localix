/**
 * Per-session preview-target registry — remembers the dev-server URL a session
 * has in play so `browser` can LAZILY auto-open the preview the first time
 * the agent drives it, instead of forcing an explicit open call. A background bash
 * job records the URL it advertised in its early output (content-detected, never
 * from the command string), and the first `browser` drive action opens it.
 *
 * Lives in the chat runtime (alongside the preview-command-registry, which owns the
 * server→host→probe relay). Injected into BOTH the browser tool deps and the
 * bash tool deps as plain function deps, so agent-core never imports this module —
 * the dependency arrow stays one-way.
 */

import { createBoundedCache } from '../../../lib/bounded-cache'

export interface PreviewTarget {
  previewId?: string
  background?: boolean
  url?: string
  injectUrl?: string
  title?: string
  /** The command that started the server — remembered for the relaunch button. */
  startCommand?: string
  startCwd?: string
  /** Whether the preview has actually been opened for the current URL yet. */
  opened: boolean
}

/** What a caller records about a freshly detected/opened preview target. */
export interface PreviewTargetInput {
  previewId?: string
  background?: boolean
  url?: string
  injectUrl?: string
  title?: string
  startCommand?: string
  startCwd?: string
}

export interface PreviewTargetRegistry {
  /**
   * Record (or refresh) the session's preview target. If the new URL's ORIGIN
   * differs from the existing one, `opened` resets to false — a new/different
   * server appeared and must be (re)opened before driving.
   */
  record(userId: string, sessionId: string, input: PreviewTargetInput): void
  get(userId: string, sessionId: string): PreviewTarget | undefined
  markOpened(userId: string, sessionId: string): void
  /** Forget the session's remembered target — used when the preview is CLOSED, so a
   *  later drive action won't lazily re-open the just-closed preview. */
  clear(userId: string, sessionId: string): void
  /** Process-local diagnostic count. */
  size(): number
}

export interface PreviewTargetRegistryOptions {
  /** Maximum remembered user/session targets. Default 256. */
  maxEntries?: number
}

export const DEFAULT_MAX_PREVIEW_TARGETS = 256

function keyFor(userId: string, sessionId: string): string {
  return `${userId}:${sessionId}`
}

/** Safe origin extraction — a non-URL string yields undefined (no throw). */
function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

export function createPreviewTargetRegistry(
  options: PreviewTargetRegistryOptions = {},
): PreviewTargetRegistry {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_PREVIEW_TARGETS
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError('maxEntries must be a positive safe integer')
  }
  const targets = createBoundedCache<string, PreviewTarget>({ maxEntries })

  return {
    record(userId, sessionId, input) {
      const key = keyFor(userId, sessionId)
      const prev = targets.peek(key)
      // A different origin means a new/different server — it hasn't been opened yet.
      // Same origin (a refresh / re-detect of the same server) keeps `opened` as-is.
      const sameOrigin = Boolean(prev?.url) && originOf(prev?.url) === originOf(input.url)
      const sameRecipe =
        (input.startCommand === undefined || input.startCommand === prev?.startCommand) &&
        (input.startCwd === undefined || input.startCwd === prev?.startCwd)
      targets.set(key, {
        previewId: input.previewId ?? (sameOrigin ? prev?.previewId : undefined),
        background: input.background ?? (sameOrigin ? prev?.background : undefined),
        url: input.url ?? prev?.url,
        injectUrl: input.injectUrl ?? (sameOrigin ? prev?.injectUrl : undefined),
        title: input.title ?? (sameOrigin ? prev?.title : undefined),
        startCommand: input.startCommand ?? (sameOrigin ? prev?.startCommand : undefined),
        startCwd:
          input.startCwd ??
          (sameOrigin &&
          (input.startCommand === undefined || input.startCommand === prev?.startCommand)
            ? prev?.startCwd
            : undefined),
        opened: sameOrigin && sameRecipe ? (prev?.opened ?? false) : false,
      })
    },

    get(userId, sessionId) {
      return targets.get(keyFor(userId, sessionId))
    },

    markOpened(userId, sessionId) {
      const target = targets.peek(keyFor(userId, sessionId))
      if (target) target.opened = true
    },

    clear(userId, sessionId) {
      targets.delete(keyFor(userId, sessionId))
    },

    size: () => targets.size,
  }
}

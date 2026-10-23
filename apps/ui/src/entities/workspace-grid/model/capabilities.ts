// Per-kind metadata the pure reducers consult — React-free, so it lives in the
// model layer. The actual renderer (React component) + reviver (deserialize)
// bind in the widget layer's registry; this holds only the structural rules.
import type { CoreWorkItemKind, WorkItem, WorkItemKind } from '@/shared/lib/workItem'
import { workItemKindRegistry, type WorkItemKindContribution } from '@/shared/contrib/uiContrib'
import {
  areMiniAppContributionsPending,
  areMiniAppUiLoadsInFlight,
  miniAppContributionActivation,
} from '@/shared/contrib/miniAppActivation'

export interface WorkItemCapability {
  /** One instance per scope (fixed id, qualified by its session — `tabIdInScope`). Splitting or
   *  opening reveals it, never duplicates. */
  singleton?: boolean
  /** Restored after a reload (re-fetches/re-derives its own content). */
  restorable?: boolean
  /** Can ride the shared per-group "preview" slot (so it carries the `ephemeral`
   *  pin flag): a non-pinned file/diff, or an always-throw-away stream. */
  ephemeralSlot?: boolean
  /** Rides the preview slot but is ALWAYS ephemeral — never user-pinned (a live
   *  file-change stream). Distinguishes it from the pinnable file/diff. */
  alwaysEphemeral?: boolean
  /** Counted against the per-group file-tab cap (MAX_FILE_TABS): real files +
   *  live streams. */
  countsToFileCap?: boolean
  /** The body is a workspace-file document addressed by `payload.path` (file,
   *  diff) — drives the file-tree active-row highlight of the focused document. */
  pathBacked?: boolean
  /** Which scope owns this kind. Omitted = 'session': the tab belongs to the chat its opener
   *  names. 'global' is reserved for APP-LEVEL kinds that read no session at all (settings,
   *  usage, an agent profile) — a kind that reads a session is never global. */
  scope?: 'session' | 'global'
}

/** The cap table. A kind absent here gets the all-false default. */
export const WORK_ITEM_CAPS: Record<CoreWorkItemKind, WorkItemCapability> = {
  // Every kind renders directly in its group (no keep-alive portal). State that
  // must survive a remount lives elsewhere: chat in the store, the terminal PTY on
  // the backend (panes re-attach by terminalId), preview is a reloadable iframe.
  chat: { restorable: true },
  // Content lives in memory with its opener, so a restored tab would restore an empty transcript.
  transcript: {},
  file: { restorable: true, ephemeralSlot: true, countsToFileCap: true, pathBacked: true },
  diff: { ephemeralSlot: true, pathBacked: true },
  // One Browser per chat: it shows that chat's previews, never the previews of whichever chat
  // is on screen.
  preview: { singleton: true, restorable: true },
  // A third-party bridged VIEW tab. NOT restorable: on reload it should re-open
  // only if its mini app is still enabled (the rail button re-appears), so a
  // disabled/uninstalled mini app never leaves a dead tab behind. Session-scoped: a prompt it
  // sends and the session events it receives are its own chat's.
  'mini-app-view': {},
  'live-file-change': { ephemeralSlot: true, alwaysEphemeral: true, countsToFileCap: true },
  // An agent record is not bound to a session, and its profile re-reads the registry on mount,
  // so a restored tab comes back with what the record says NOW rather than a stale copy.
  agent: { scope: 'global', restorable: true },
  stats: { singleton: true, restorable: true, scope: 'global' },
  // One Problems panel per chat: the diagnostics of that chat's language servers.
  problems: { singleton: true, restorable: true },
  settings: { singleton: true, restorable: true, scope: 'global' },
  // A terminal is a normal session-scoped tab (one per backend PTY) — NOT a
  // singleton: several terminals are several tabs, and the grid's own split/move
  // gives "one terminal here, another there". Restorable so the layout + which
  // PTYs were open survive a reload; the pane reattaches to the surviving
  // server-side PTY by id (a dead id self-closes), so no separate manager/store.
  terminal: { restorable: true },
  // `table` is a CONTRIBUTED kind now (its owner registers it with
  // restorable: true, scope 'session') — its caps come from the open registry.
  // One "Activity" replay tab per chat — it shows the focused message of ITS chat via the
  // message-focus store, so its content isn't in the payload and it can't be restored cold (the
  // store is empty after a reload). Reopened on demand.
  'message-replay': { singleton: true },
  // One Search tab per chat (fixed id → reveal, never duplicate): it searches that chat's
  // workspace. Restorable so it survives a reload (it re-fetches its own results).
  'global-search': { singleton: true, restorable: true },
}

const EMPTY_CAP: WorkItemCapability = {}

function builtInCapsOf(kind: WorkItemKind): WorkItemCapability | undefined {
  return Object.prototype.hasOwnProperty.call(WORK_ITEM_CAPS, kind)
    ? WORK_ITEM_CAPS[kind as CoreWorkItemKind]
    : undefined
}

/** Whether core has its own capability + renderer contract for this kind. */
export function isBuiltInWorkItemKind(kind: WorkItemKind): boolean {
  return builtInCapsOf(kind) !== undefined
}

/** Resolve only mini-app-exclusive work-item kinds. A bundled mini app colliding
 * with a reserved core kind must never replace core rendering, placement,
 * capabilities, icons, or message-binding behavior. */
export function activeWorkItemContribution(
  kind: WorkItemKind,
): WorkItemKindContribution | undefined {
  return isBuiltInWorkItemKind(kind) ? undefined : workItemKindRegistry.get(kind)
}

/** Which scope owns a kind (defaults to the per-session grid). */
export function scopeKindOf(kind: WorkItemKind): 'session' | 'global' {
  return capsOf(kind).scope ?? 'session'
}

export function capsOf(kind: WorkItemKind): WorkItemCapability {
  // Mini-app-exclusive kinds derive their structural caps from the contribution.
  // Reserved core kinds always retain their built-in contract.
  const contributed = activeWorkItemContribution(kind)
  if (contributed) {
    return { restorable: contributed.restorable, scope: contributed.scope }
  }
  return builtInCapsOf(kind) ?? EMPTY_CAP
}

export function isSingleton(kind: WorkItemKind): boolean {
  return capsOf(kind).singleton === true
}

export function isRestorable(kind: WorkItemKind): boolean {
  return capsOf(kind).restorable === true
}

/**
 * Persistence uses a cold-start-aware answer. A registered mini app whose enabled set has
 * not loaded yet is retained; only an authoritatively disabled mini app is discarded.
 * Runtime rendering still uses {@link isRestorable}/the activation-gated registry.
 */
export function isRestorableForPersistence(kind: WorkItemKind): boolean {
  const contributed = workItemKindRegistry.getRegistered(kind)
  const builtIn = builtInCapsOf(kind)
  if (!contributed) {
    if (builtIn) return builtIn.restorable === true
    // Lazy bundled mini app modules are deliberately not registered until the
    // backend confirms they are enabled. Preserve their serialized tabs during
    // that cold window; the authoritative pass below removes true leftovers.
    return areMiniAppContributionsPending()
  }
  const activation = miniAppContributionActivation(contributed.miniAppName)
  // A mini app may accidentally reuse a built-in kind. While that mini app is pending
  // or disabled, its dormant registration must not make the core kind disappear
  // from persistence. Keeping a tab when either possible owner is restorable is
  // the lossless cold-start answer; an enabled mini app still owns its live contract.
  if (activation === 'pending') {
    return contributed.restorable === true || builtIn?.restorable === true
  }
  if (activation === 'disabled') return builtIn?.restorable === true
  return contributed.restorable === true
}

/**
 * Which scope a stored kind belongs to, cold-start aware like {@link isRestorableForPersistence}:
 * a built-in or registered kind answers from its declaration even while its mini app is still
 * activating; `null` means its owner has not registered yet, so nothing is known about it.
 *
 * The activation-gated {@link scopeKindOf} answers 'session' for any kind it cannot see yet, so a
 * restore that used it dropped every global tab of a mini app still loading.
 */
export function persistedScopeKindOf(kind: WorkItemKind): 'session' | 'global' | null {
  const contributed = workItemKindRegistry.getRegistered(kind)
  if (contributed) return contributed.scope ?? 'session'
  const builtIn = builtInCapsOf(kind)
  return builtIn ? (builtIn.scope ?? 'session') : null
}

/** True after the backend confirms that a mini-app-only kind has no active renderer. */
export function isUnavailableContributedKind(kind: WorkItemKind): boolean {
  if (isBuiltInWorkItemKind(kind) || areMiniAppContributionsPending()) return false
  const contributed = workItemKindRegistry.getRegistered(kind)
  // Disabled bundled mini apps were never imported, so their kinds are unknown
  // rather than registered-with-a-disabled-owner. Once activation is
  // authoritative, both states mean the persisted tab cannot be rendered.
  return (
    contributed === undefined ||
    miniAppContributionActivation(contributed.miniAppName) === 'disabled'
  )
}

/**
 * A restored mini-app-only kind whose owner may still be loading — what "Restoring…" may promise.
 * Only an ATTEMPTED load counts: a mini app that ran out of retries still keeps its tabs (see
 * {@link isUnavailableContributedKind}) but no longer claims to be on its way.
 */
export function isPendingContributedKind(kind: WorkItemKind): boolean {
  if (isBuiltInWorkItemKind(kind) || !areMiniAppUiLoadsInFlight()) return false
  const contributed = workItemKindRegistry.getRegistered(kind)
  // With lazy discovery an enabled mini app's kind is initially unknown. Render
  // the restoring placeholder until the first activation snapshot decides it.
  return (
    contributed === undefined ||
    miniAppContributionActivation(contributed.miniAppName) === 'pending'
  )
}

/** A kind that CAN ride the shared preview slot (so it carries the `ephemeral`
 *  pin flag). Cap-driven so callers never re-hardcode the file/diff literal set. */
export function isEphemeralCapable(kind: WorkItemKind): boolean {
  return capsOf(kind).ephemeralSlot === true
}

/** A workspace-file-backed kind whose `payload.path` is the document shown
 *  (file, diff) — drives the file-tree highlight of the focused document. */
export function isPathBacked(kind: WorkItemKind): boolean {
  return capsOf(kind).pathBacked === true
}

/** An item occupying the shared preview slot: an always-throw-away stream
 *  (live-file-change), or a slot-capable file/diff flagged `ephemeral`. All
 *  table-driven — no kind literals. */
export function isEphemeralItem(item: WorkItem): boolean {
  const caps = capsOf(item.kind)
  return caps.alwaysEphemeral === true || (caps.ephemeralSlot === true && item.ephemeral === true)
}

/** Counted against the per-group file-tab cap (real files + live streams). */
export function isCappedFileItem(item: WorkItem): boolean {
  return capsOf(item.kind).countsToFileCap === true
}

/** A slot item the user explicitly pinned (`ephemeral === false`) — must survive
 *  ephemeral re-opens. The always-ephemeral stream kinds are never pinnable. */
export function isPinnedItem(item: WorkItem | undefined): boolean {
  if (!item) return false
  const caps = capsOf(item.kind)
  return caps.ephemeralSlot === true && caps.alwaysEphemeral !== true && item.ephemeral === false
}

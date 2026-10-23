/**
 * Who owns the keyboard right now, and what it will tolerate.
 *
 * Lives in the SDK rather than in the workspace app because a plugin workbench has exactly the same
 * problem: it opens surfaces, wants keys while they are up, and must not fire behind a host dialog.
 * One stack shared by the host and every plugin is the only version of that which can answer
 * correctly — two stacks would each be confidently wrong about the other's overlays.
 *
 * The alternative — and what this replaces — is asking the DOM. `actionContextFromTarget` used to
 * answer "is a menu open?" with a querySelector for `[data-radix-popper-content-wrapper]`: a
 * third-party library's internal class standing in for a product decision. It is wrong in both
 * directions. A surface that owns the keyboard without rendering that markup is invisible to it,
 * and a library upgrade that renames the wrapper silently re-enables every global shortcut.
 */

/**
 * What kind of thing took focus. Only used to pick a default policy and to read a stack dump during
 * debugging — the dispatcher never branches on it.
 */
export type FocusKind = 'dialog' | 'menu' | 'overlay' | 'text-input' | 'editor' | 'surface'

/**
 * What classes of GLOBAL shortcut the focused surface tolerates.
 *
 * The inversion matters: the focused element declares what it can live with, and never needs to
 * know which shortcuts exist. Without it, every new global shortcut has to be checked against every
 * surface that might be focused — an O(n²) matrix that nobody maintains.
 */
export interface GlobalKeyPolicy {
  /** Single keys with no modifier (`j`, `/`, `1`) — the ones that collide with typing. */
  plainKeys: boolean
  /** Chords carrying a command modifier — the primary accelerator, Control or Alt. */
  modifierKeys: boolean
}

export interface FocusEntry {
  /** Stable per surface. Re-focusing the same id moves it up the stack instead of duplicating it. */
  id: string
  kind: FocusKind
  keyboard: GlobalKeyPolicy
  /** Pane-local claims apply only to events inside this root. Omit for modal ownership. */
  scope?: () => Element | null
  /**
   * Keys this surface handles while it owns the keyboard.
   *
   * Offered the event BEFORE the shortcut catalog, innermost surface first — which is what lets an
   * Escape-to-dismiss be written once, without a global listener and without asking the DOM whether
   * something else is open.
   *
   * Return `true` to claim the key: the walk stops and the catalog does not also act. Claiming is
   * an explicit return rather than `preventDefault()` because a non-cancelable event ignores
   * `preventDefault()` silently, and "the handler ran but nothing was claimed" is indistinguishable
   * from "no handler ran" — a difference that decides whether a second surface also fires.
   */
  onKeyDown?: (event: KeyboardEvent) => boolean | void
}

/**
 * Defaults per kind. A surface may override, but the defaults are what make the common case correct
 * without anybody thinking about it.
 */
export const DEFAULT_KEY_POLICY: Readonly<Record<FocusKind, GlobalKeyPolicy>> = {
  // A modal owns everything while it is up: a global chord firing behind it acts on a surface the
  // user cannot see.
  dialog: { plainKeys: false, modifierKeys: false },
  menu: { plainKeys: false, modifierKeys: false },
  overlay: { plainKeys: false, modifierKeys: false },
  // Typing must never trigger a shortcut; a deliberate chord still should.
  'text-input': { plainKeys: false, modifierKeys: true },
  // The code editor binds its own plain keys and handles chords it knows.
  editor: { plainKeys: false, modifierKeys: true },
  // An ordinary pane: the normal case, where every global shortcut works.
  surface: { plainKeys: true, modifierKeys: true },
}

/** The policy that applies when nothing has claimed focus. */
export const UNFOCUSED_KEY_POLICY: GlobalKeyPolicy = DEFAULT_KEY_POLICY.surface

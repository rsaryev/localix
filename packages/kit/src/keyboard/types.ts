/**
 * Keyboard-shortcut model. A "chord" is one keystroke (modifiers + a main key),
 * stored as a platform-NEUTRAL canonical string so the same binding works on
 * every OS. The token `mod` stands for the platform's primary modifier — ⌘ on
 * macOS/iOS, Ctrl on Windows/Linux — and is resolved to the concrete key only
 * at match/format time (see `chord.ts`).
 *
 * Canonical chord grammar: modifier tokens joined by `+`, then the main key,
 * all lowercase. `secondary` is the other command modifier — Control on macOS,
 * Meta/Windows/Super elsewhere.
 * Modifier order is fixed (`mod` → `secondary` → `alt` → `shift`) so
 * a chord has exactly one string form. Examples:
 *   "mod+p"            ⌘P / Ctrl+P
 *   "mod+shift+o"      ⌘⇧O / Ctrl+Shift+O
 *   "mod+secondary+k"  ⌘⌃K / Ctrl+Win+K
 *   "mod+alt+arrowleft"
 *   "f2"               (no modifiers)
 *   "enter" / "escape" / "shift+enter"
 */

/** A canonical chord string (see grammar above), or `null` for "unassigned". */
export type Chord = string | null

/** Logical command categories — used only to group the settings list. */
export type ShortcutCategory = 'navigation' | 'layout' | 'editor' | 'composer' | 'search' | 'files'

export interface ShortcutCommand {
  /** Stable id — the persistence key for overrides. Never reuse/rename lightly. */
  id: string
  label: string
  description: string
  category: ShortcutCategory
  /** Catalog default chord (canonical), or `null` if unbound by default. */
  defaultChord: Chord
  /**
   * Optional action-context expression. The global action dispatcher evaluates
   * it at keydown time (for example `!inputFocus && !menuOpen`). Handler sites
   * no longer need to repeat those focus/overlay guards.
   */
  when?: string
  /**
   * Whether this command is actually wired through the registry (so a rebind
   * takes effect). `false` = the shortcut is an intrinsic interaction key shown
   * for reference only (e.g. arrow-key menu navigation). Defaults to `true`.
   */
  configurable?: boolean
}

/** Resolved binding map: command id → the effective chord after overrides. */
export type ResolvedBindings = Record<string, Chord>

/** Persisted overrides: command id → chord (or `null` = explicitly unassigned). */
export type BindingOverrides = Record<string, Chord>

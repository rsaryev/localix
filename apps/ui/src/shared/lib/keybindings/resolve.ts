/**
 * Pure binding resolution — merges catalog defaults with the user's overrides
 * and reports same-category conflicts. Kept in its own module (not the barrel)
 * so the reactive `store.ts` can import it without a circular dependency.
 */

import { SHORTCUT_CATALOG, isConfigurable } from './catalog'
import { canonicalizeChord } from '@localixai/kit/keybindings'
import type {
  BindingOverrides,
  Chord,
  ResolvedBindings,
  ShortcutCommand,
} from '@localixai/kit/keybindings'

/**
 * Effective binding for each command: an override wins (including an explicit
 * `null` = unassigned); otherwise the catalog default. Non-configurable
 * commands always resolve to their default (overrides are ignored for them).
 */
export function resolveBindings(overrides: BindingOverrides | undefined): ResolvedBindings {
  const out: ResolvedBindings = {}
  for (const cmd of SHORTCUT_CATALOG) {
    if (
      isConfigurable(cmd) &&
      overrides &&
      Object.prototype.hasOwnProperty.call(overrides, cmd.id)
    ) {
      out[cmd.id] = canonicalizeChord(overrides[cmd.id])
    } else {
      out[cmd.id] = cmd.defaultChord
    }
  }
  return out
}

/**
 * Configurable commands in the same category whose resolved chords collide.
 * Cross-category duplicates (e.g. ⌘↵ for both message-edit and commit) are
 * legitimate — they fire in different contexts — so only same-category clashes
 * are reported. Returns a set of conflicting command ids.
 */
export function findConflicts(resolved: ResolvedBindings): Set<string> {
  const conflicts = new Set<string>()
  const seen = new Map<string, string>() // `${category}|${chord}` → first command id
  for (const cmd of SHORTCUT_CATALOG) {
    if (!isConfigurable(cmd)) continue
    const chord = resolved[cmd.id]
    if (!chord) continue
    const key = `${cmd.category}|${chord}`
    const prior = seen.get(key)
    if (prior) {
      conflicts.add(prior)
      conflicts.add(cmd.id)
    } else {
      seen.set(key, cmd.id)
    }
  }
  return conflicts
}

/**
 * Which configurable commands would a candidate `chord` collide with if it were
 * assigned to `commandId`? Returns the OTHER same-category commands whose
 * currently-resolved chord equals `chord` — excluding the command itself, so a
 * no-op re-record of the existing binding reports nothing. Cross-category
 * duplicates are legitimate (different contexts) and never reported, mirroring
 * `findConflicts`. Used to warn (and name the owner) at record time and to name
 * the conflicting command(s) on the post-hoc badge tooltip. Pure — takes the
 * already-resolved map so callers share one source of truth.
 */
export function conflictingCommands(
  commandId: string,
  chord: Chord,
  resolved: ResolvedBindings,
): ShortcutCommand[] {
  const target = canonicalizeChord(chord)
  if (!target) return []
  const self = SHORTCUT_CATALOG.find((c) => c.id === commandId)
  if (!self || !isConfigurable(self)) return []
  return SHORTCUT_CATALOG.filter(
    (c) =>
      c.id !== commandId &&
      isConfigurable(c) &&
      c.category === self.category &&
      resolved[c.id] === target,
  )
}

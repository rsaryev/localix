import { describe, expect, it } from 'bun:test'
import { conflictingCommands, findConflicts, resolveBindings } from './resolve'
import { CMD, SHORTCUT_CATALOG } from './catalog'
import type { ResolvedBindings } from '@localixai/kit/keybindings'

/** Build a resolved map from the defaults, overlaying the given chords. */
function resolvedWith(overlay: Record<string, string | null>): ResolvedBindings {
  const base = resolveBindings(undefined)
  return { ...base, ...overlay }
}

function idsOf(commands: { id: string }[]): string[] {
  return commands.map((c) => c.id).sort()
}

describe('conflictingCommands', () => {
  it('returns nothing when the chord is unique in its category', () => {
    const resolved = resolveBindings(undefined)
    // Command palette's default chord is not shared by any other nav command.
    expect(conflictingCommands(CMD.commandPalette, resolved[CMD.commandPalette], resolved)).toEqual(
      [],
    )
  })

  it('names the other command that already owns a candidate chord (same category)', () => {
    const resolved = resolveBindings(undefined)
    // Try to give "Switch session" the chord that "Go to file" already uses.
    const owners = conflictingCommands(CMD.switchSession, resolved[CMD.goToFile], resolved)
    expect(idsOf(owners)).toEqual([CMD.goToFile])
  })

  it('excludes the command itself (re-recording the current binding is a no-op)', () => {
    const resolved = resolveBindings(undefined)
    expect(conflictingCommands(CMD.goToFile, resolved[CMD.goToFile], resolved)).toEqual([])
  })

  it('ignores cross-category duplicates (legitimate in different contexts)', () => {
    // Two commands can share a chord when they can never be live at once. The pair is built here
    // rather than named from the catalog: the catalog's own cross-category collision was a
    // source-control command that has since left core, and a test pinned to one accidental pair
    // stops testing the rule the moment the pair changes.
    const resolved = resolveBindings({ [CMD.newChat]: 'mod+enter' })
    expect(resolved[CMD.submitMessageEdit]).toBe('mod+enter')
    expect(resolved[CMD.newChat]).toBe('mod+enter')
    expect(conflictingCommands(CMD.newChat, 'mod+enter', resolved)).toEqual([])
  })

  it('is order- and case-insensitive on the candidate chord (canonicalizes)', () => {
    const resolved = resolveBindings(undefined)
    // goToSymbol default is mod+shift+o — a differently-ordered/cased string must still match.
    const owners = conflictingCommands(CMD.commandPalette, 'SHIFT+MOD+O', resolved)
    expect(idsOf(owners)).toEqual([CMD.goToSymbol])
  })

  it('reports every same-category owner when three share a chord', () => {
    const resolved = resolvedWith({
      [CMD.goToFile]: 'mod+u',
      [CMD.switchSession]: 'mod+u',
    })
    const owners = conflictingCommands(CMD.commandPalette, 'mod+u', resolved)
    expect(idsOf(owners)).toEqual([CMD.goToFile, CMD.switchSession].sort())
  })

  it('returns nothing for an empty/unassigned candidate chord', () => {
    const resolved = resolveBindings(undefined)
    expect(conflictingCommands(CMD.goToFile, null, resolved)).toEqual([])
    expect(conflictingCommands(CMD.goToFile, '', resolved)).toEqual([])
  })

  it('never reports a non-configurable command as an owner', () => {
    // sendMessage (Enter) is configurable:false — assigning Enter to a configurable
    // composer command must not list it as a conflict owner.
    const resolved = resolveBindings(undefined)
    const owners = conflictingCommands(CMD.submitMessageEdit, 'enter', resolved)
    expect(owners.every((c) => c.id !== CMD.sendMessage)).toBe(true)
  })

  it('agrees with findConflicts: a manufactured clash shows up in both', () => {
    const resolved = resolvedWith({ [CMD.switchSession]: resolveBindings(undefined)[CMD.goToFile] })
    const owners = conflictingCommands(CMD.switchSession, resolved[CMD.switchSession], resolved)
    expect(idsOf(owners)).toEqual([CMD.goToFile])
    const conflicts = findConflicts(resolved)
    expect(conflicts.has(CMD.goToFile)).toBe(true)
    expect(conflicts.has(CMD.switchSession)).toBe(true)
  })

  it('returns nothing for an unknown command id', () => {
    const resolved = resolveBindings(undefined)
    expect(conflictingCommands('does.not.exist', 'mod+p', resolved)).toEqual([])
  })

  it('every catalog default is conflict-free out of the box (per category)', () => {
    const resolved = resolveBindings(undefined)
    let checked = 0
    for (const cmd of SHORTCUT_CATALOG) {
      if (cmd.configurable === false || !resolved[cmd.id]) continue
      expect(conflictingCommands(cmd.id, resolved[cmd.id], resolved)).toEqual([])
      checked += 1
    }
    // Anchor: the `continue` above skips a command with no resolved binding. Were
    // resolveBindings(undefined) to regress to `{}` — the single most likely defect
    // this test should catch — EVERY command would be skipped, zero assertions would
    // run, and the suite would report green.
    expect(checked).toBeGreaterThan(10)
  })
})

describe('native macOS tabs reserve Command T', () => {
  it('moves workspace symbols while preserving the web default', () => {
    expect(resolveBindings(undefined, true)[CMD.goToSymbolWorkspace]).toBe('mod+alt+shift+o')
    expect(resolveBindings(undefined, false)[CMD.goToSymbolWorkspace]).toBe('mod+t')
  })
  it('keeps file search accessible when a preset uses Command T', () => {
    expect(resolveBindings({ [CMD.goToFile]: 'mod+t' }, true)[CMD.goToFile]).toBe('mod+p')
    expect(resolveBindings({ [CMD.goToFile]: 'mod+t' }, false)[CMD.goToFile]).toBe('mod+t')
  })
  it('does not let a saved override shadow native tabs', () => {
    expect(resolveBindings({ [CMD.newChat]: 'mod+t' }, true)[CMD.newChat]).toBeNull()
    expect(resolveBindings({ [CMD.newChat]: 'meta+t' }, true)[CMD.newChat]).toBeNull()
    expect(resolveBindings({ [CMD.newChat]: 'mod+alt+n' }, true)[CMD.newChat]).toBe('mod+alt+n')
  })
})

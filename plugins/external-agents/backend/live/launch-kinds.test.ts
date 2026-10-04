import { describe, expect, test } from 'bun:test'
import { detectLaunchCwd, detectLaunchKind } from './launch-kinds'
import { agentLaunchCommand } from '../../shared/launch'

/**
 * The launchers the titlebar quick actions offer, as `shared/launch.ts` declares them.
 *
 * Repeated here rather than imported because that module is a `.tsx` carrying brand marks and SDK
 * UI types; what has to be shared is the COMMAND FORMAT, and that now lives in `shared/launch.ts`,
 * which both halves derive from.
 */
const PROFILES = [
  { provider: 'claude-code', executable: 'claude' },
  { provider: 'codex', executable: 'codex' },
  { provider: 'opencode', executable: 'opencode' },
  { provider: 'gemini-cli', executable: 'gemini' },
] as const

describe('the real emitter through the real parser', () => {
  /**
   * Every other case in this file writes the launch line out BY HAND, so the contract between the
   * emitter and the reader was being checked against a restatement of itself. A drift there does not
   * fail loudly — terminals open, agents run, and nothing is ever adopted as a delegation.
   */
  test('every profile the tab strip offers is read back as its own agent kind', () => {
    for (const profile of PROFILES) {
      const command = agentLaunchCommand(profile)
      expect(detectLaunchKind(command)).toBe(profile.provider)
      // No directory declared, so none must be invented.
      expect(detectLaunchCwd(command)).toBeUndefined()
    }
  })

  test('the DECLARATION carries the kind, not the executable name', () => {
    // The case above cannot tell the two apart: `detectLaunchKind` falls back to sniffing the
    // executable, and for these four profiles the fallback happens to give the same answer — so a
    // broken declaration would pass it. Proved that by quoting the provider value in the emitter:
    // the case still passed while the declaration matched nothing.
    //
    // The declaration exists precisely for the case the fallback cannot serve — a wrapper, a shim or
    // a version manager standing where the binary should be. So it is checked with an executable
    // name nothing recognises.
    for (const profile of PROFILES) {
      const command = agentLaunchCommand({ provider: profile.provider, executable: 'my-wrapper' })
      expect(detectLaunchKind(command)).toBe(profile.provider)
    }
    // And with neither a declaration nor a known executable there is nothing to report: a guess
    // here would adopt an unrelated pane as a delegation.
    expect(detectLaunchKind('my-wrapper --serve')).toBeUndefined()
  })

  test('a declared directory survives the round trip, spaces included', () => {
    // The value the emitter quotes and the value the parser unquotes have to be the same string:
    // correlation narrows candidates by it, and a path that came back with its quotes attached
    // matches nothing.
    const cwd = '/Users/dev/code/project with space'
    const command = agentLaunchCommand({ provider: 'codex', executable: 'codex', cwd })
    expect(detectLaunchKind(command)).toBe('codex')
    expect(detectLaunchCwd(command)).toBe(cwd)
  })
})

/**
 * The shape a delegate command emits, trimmed to the parts a reader here has to survive: two
 * declarations, then the executable, then trailing flags.
 */
function claudeLine(cwd: string): string {
  return `LOCALIX_AGENT=claude-code LOCALIX_AGENT_CWD=${cwd} claude --dangerously-skip-permissions`
}

describe('the declared cwd', () => {
  test('a bare path is read back verbatim', () => {
    expect(detectLaunchCwd(claudeLine('/Users/dev/sample-project'))).toBe(
      '/Users/dev/sample-project',
    )
  })

  test('a path with a space arrives single-quoted and is unquoted', () => {
    expect(detectLaunchCwd(claudeLine("'/Users/dev/dir with space'"))).toBe(
      '/Users/dev/dir with space',
    )
  })

  test("an apostrophe in the path survives the shell's '\\'' splice", () => {
    expect(detectLaunchCwd(claudeLine("'/Users/o'\\''brien/work'"))).toBe("/Users/o'brien/work")
  })

  test('the quoted value ends at its own closing quote, not at one inside the protocol', () => {
    // The greedy alternative would swallow the executable and the whole inlined protocol.
    expect(detectLaunchCwd(claudeLine("'/tmp/a b'"))).toBe('/tmp/a b')
  })

  test('a launch that declares nothing has no cwd, rather than an empty one', () => {
    expect(detectLaunchCwd('claude --dangerously-skip-permissions')).toBeUndefined()
    expect(detectLaunchCwd('LOCALIX_AGENT=claude-code claude')).toBeUndefined()
    expect(detectLaunchCwd(undefined)).toBeUndefined()
  })

  test('an empty declaration is treated as absent, in either shape', () => {
    expect(detectLaunchCwd("LOCALIX_AGENT_CWD='' claude")).toBeUndefined()
    expect(detectLaunchCwd('LOCALIX_AGENT_CWD= claude')).toBeUndefined()
  })

  test('the cwd declaration is not mistaken for the provider hint', () => {
    // `LOCALIX_AGENT` is a prefix of `LOCALIX_AGENT_CWD`; only the `=` separates them.
    expect(detectLaunchKind('LOCALIX_AGENT_CWD=/tmp/x codex')).toBe('codex')
    expect(detectLaunchKind(claudeLine('/tmp/x'))).toBe('claude-code')
  })
})

import { describe, expect, test } from 'bun:test'

import { correlateOnce } from './correlate'
import { LiveStore } from './store'
import { ManifestRegistry } from '../detection/registry'
import type { SessionIndex } from '../discovery/index-cache'
import type { ProviderAdapter } from '../adapters/types'
import type { SessionSummary } from '../../shared/contracts'

/**
 * Correlation is what makes "a live delegation" and "its transcript" one row instead of two
 * unrelated features, and its own header calls it the hinge of the plugin — but it had no test, and
 * the `cwd` argument that its most important rule depends on went unpassed for its whole life.
 *
 * The property worth pinning is the REFUSAL: attaching a delegation to the wrong transcript is
 * silent and unrecoverable, so an ambiguous match must adopt nothing at all.
 */
const NOW = Date.now()

function summary(partial: Partial<SessionSummary> & { nativeSessionId: string }): SessionSummary {
  return {
    key: `claude-code:${partial.nativeSessionId}`,
    provider: 'claude-code',
    title: partial.nativeSessionId,
    updatedAt: NOW,
    sourcePath: `/tmp/${partial.nativeSessionId}.jsonl`,
    ...partial,
  }
}

function indexOf(summaries: readonly SessionSummary[]): SessionIndex {
  return {
    async scan() {
      return {
        summaries,
        status: {
          provider: 'claude-code',
          displayName: 'Claude Code',
          roots: [],
          sessionCount: summaries.length,
          verified: true,
        },
      }
    },
  } as unknown as SessionIndex
}

const adapter = { id: 'claude-code', displayName: 'Claude Code' } as ProviderAdapter

function liveStore(cwd?: string): { live: LiveStore; terminalId: string } {
  const live = new LiveStore(new ManifestRegistry('/nonexistent-state-dir', () => {}))
  live.open({
    terminalId: 't1',
    localixSessionId: 's1',
    provider: 'claude-code',
    ...(cwd ? { cwd } : {}),
  })
  return { live, terminalId: 't1' }
}

describe('a long-running session is not a candidate', () => {
  /**
   * The discriminator is when a session STARTED, not when it was last touched. A session that has
   * been running for hours is touched every few seconds, so on `updatedAt` every long-lived agent in
   * the directory stayed a candidate forever.
   *
   * Measured on a real local history mid-session: two Claude Code agents working in one project, started
   * 9,564 s and 75,190 s ago, both touched within the window. Correlation was ambiguous at every
   * window size and would have refused for as long as they both ran — and concurrent agents in one
   * project is what this plugin is FOR, not an edge case.
   */
  const HOURS_AGO = NOW - 3 * 60 * 60 * 1000

  test('a fresh session is adopted even beside one that has run for hours', async () => {
    const { live, terminalId } = liveStore('/work/app')
    const result = await correlateOnce(
      indexOf([
        // Long-lived and busy: started hours ago, touched this second, same directory.
        summary({ nativeSessionId: 'long-runner', startedAt: HOURS_AGO, cwd: '/work/app' }),
        summary({ nativeSessionId: 'just-launched', startedAt: NOW - 2_000, cwd: '/work/app' }),
      ]),
      adapter,
      live,
      terminalId,
      '/work/app',
    )
    expect(result.adopted).toBe('just-launched')
  })

  test('nothing started since launch adopts nothing, and says start rather than touch', async () => {
    const { live, terminalId } = liveStore('/work/app')
    const result = await correlateOnce(
      indexOf([
        summary({ nativeSessionId: 'long-runner', startedAt: HOURS_AGO, cwd: '/work/app' }),
      ]),
      adapter,
      live,
      terminalId,
      '/work/app',
    )
    expect(result.adopted).toBeUndefined()
    expect(result.reason).toContain('has STARTED since the agent launched')
    expect(live.get(terminalId)?.nativeSessionId).toBeUndefined()
  })

  test('two sessions that really did start together are still refused', async () => {
    // The safety property is unchanged: narrowing the question must not turn an ambiguous match into
    // a guess.
    const { live, terminalId } = liveStore('/work/app')
    const result = await correlateOnce(
      indexOf([
        summary({ nativeSessionId: 'a', startedAt: NOW - 3_000, cwd: '/work/app' }),
        summary({ nativeSessionId: 'b', startedAt: NOW - 1_000, cwd: '/work/app' }),
      ]),
      adapter,
      live,
      terminalId,
      '/work/app',
    )
    expect(result.adopted).toBeUndefined()
    expect(result.reason).toContain('ambiguous')
  })

  test('a provider that records no start still correlates on last-touched', async () => {
    // Coverage is near-total but not total (1,471 of 1,476 Claude Code sessions), and the fallback is
    // what keeps those few correlatable rather than silently unreachable forever.
    const { live, terminalId } = liveStore()
    const result = await correlateOnce(
      indexOf([summary({ nativeSessionId: 'no-start', updatedAt: NOW })]),
      adapter,
      live,
      terminalId,
    )
    expect(result.adopted).toBe('no-start')
  })
})

describe('correlating a delegation to its transcript', () => {
  test('one fresh transcript is adopted', async () => {
    const { live, terminalId } = liveStore()
    const result = await correlateOnce(
      indexOf([summary({ nativeSessionId: 'only' })]),
      adapter,
      live,
      terminalId,
    )
    expect(result.adopted).toBe('only')
    expect(live.get(terminalId)?.nativeSessionId).toBe('only')
  })

  test('two fresh transcripts adopt NOTHING, and say why', async () => {
    // Picking the newest would be right most of the time and silently wrong the rest, which is the
    // worst trade available: a delegation attached to someone else's transcript never announces it.
    const { live, terminalId } = liveStore()
    const result = await correlateOnce(
      indexOf([summary({ nativeSessionId: 'a' }), summary({ nativeSessionId: 'b' })]),
      adapter,
      live,
      terminalId,
    )
    expect(result.adopted).toBeUndefined()
    expect(result.reason).toContain('ambiguous')
    expect(live.get(terminalId)?.nativeSessionId).toBeUndefined()
  })

  test('a cwd match resolves the ambiguity two fresh transcripts create', async () => {
    // The rule the module was written around — and the one that did nothing until the launcher
    // started declaring its cwd.
    const { live, terminalId } = liveStore('/work/app')
    const result = await correlateOnce(
      indexOf([
        summary({ nativeSessionId: 'here', cwd: '/work/app' }),
        summary({ nativeSessionId: 'elsewhere', cwd: '/work/other' }),
      ]),
      adapter,
      live,
      terminalId,
      '/work/app',
    )
    expect(result.adopted).toBe('here')
  })

  test('a cwd that matches nothing is ignored rather than obeyed', async () => {
    // A provider that records no cwd (Gemini CLI) would otherwise correlate to nothing forever.
    const { live, terminalId } = liveStore('/work/app')
    const result = await correlateOnce(
      indexOf([summary({ nativeSessionId: 'only' })]),
      adapter,
      live,
      terminalId,
      '/work/app',
    )
    expect(result.adopted).toBe('only')
  })

  test('a transcript older than the launch window is not this delegation', async () => {
    const { live, terminalId } = liveStore()
    const result = await correlateOnce(
      indexOf([summary({ nativeSessionId: 'yesterday', updatedAt: NOW - 86_400_000 })]),
      adapter,
      live,
      terminalId,
    )
    expect(result.adopted).toBeUndefined()
    expect(result.reason).toContain('since the agent launched')
  })

  test('the cwd the launcher declared reaches correlation through the live entry', async () => {
    // The full chain, written across three files: the launch line declares LOCALIX_AGENT_CWD,
    // observe parses it onto the entry, and the service passes THAT to correlateOnce. Each link
    // had a test; the chain did not, and the argument sat unused for months.
    const { live, terminalId } = liveStore('/work/app')
    expect(live.get(terminalId)?.cwd).toBe('/work/app')
    const result = await correlateOnce(
      indexOf([
        summary({ nativeSessionId: 'here', cwd: '/work/app' }),
        summary({ nativeSessionId: 'elsewhere', cwd: '/work/other' }),
      ]),
      adapter,
      live,
      terminalId,
      live.get(terminalId)?.cwd,
    )
    expect(result.adopted).toBe('here')
  })

  test('an already-correlated delegation is left alone', async () => {
    const { live, terminalId } = liveStore()
    live.adopt(terminalId, 'first')
    const result = await correlateOnce(
      indexOf([summary({ nativeSessionId: 'second' })]),
      adapter,
      live,
      terminalId,
    )
    expect(result.adopted).toBe('first')
    expect(live.get(terminalId)?.nativeSessionId).toBe('first')
  })
})

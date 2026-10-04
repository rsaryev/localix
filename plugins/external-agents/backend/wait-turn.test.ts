/**
 * A wait must not settle on a delegation that is mid-turn.
 *
 * This is the failure the transcript authority was built for, tested where it actually happens. Two
 * facts make it subtle:
 *
 *  - for a screen-detected agent the manifest degrades to `idle` when no rule matches, and for
 *    Claude Code that is EVERY non-blocked screen (its working state lives in the terminal's OSC
 *    title, which the host's snapshot does not carry);
 *  - a wait evaluates its condition BEFORE its first poll, because a condition that already holds
 *    must return immediately rather than block.
 *
 * Together those meant a wait on a busy Claude Code delegation returned `satisfied` in under a
 * millisecond. Reading the log on the ticks alone would not have fixed it — the answer has to be in
 * the store before the first evaluation, which is what this pins.
 */

import { describe, expect, spyOn, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { adapterFor } from './adapters/registry'
import { AgentSessionsService } from './service'

const SESSION_ID = '11111111-2222-3333-4444-555555555555'

/** The shapes a real `~/.claude/projects/**.jsonl` ends with, one per line. */
const MID_TURN = [
  { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'find the flag' }] } },
  {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash' }] },
  },
  { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
]
const FINISHED = [
  ...MID_TURN,
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } },
]

async function serviceWith(records: readonly unknown[]) {
  const home = await mkdtemp(join(tmpdir(), 'wait-turn-home-'))
  const dir = join(home, '.claude', 'projects', '-work-app')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, `${SESSION_ID}.jsonl`),
    records.map((record) => JSON.stringify(record)).join('\n'),
    'utf8',
  )
  const state = await mkdtemp(join(tmpdir(), 'wait-turn-state-'))
  const service = new AgentSessionsService(state, () => {}, { env: {}, homeDir: home })

  // The hook path, as the host drives it: a terminal opens running claude-code, then a screen no
  // manifest rule matches arrives — the degraded case.
  service.handleToolCall({
    toolName: 'bash',
    input: {},
    result: {
      content: '',
      details: {
        action: 'open',
        terminalId: 't1',
        command: "LOCALIX_AGENT=claude-code LOCALIX_AGENT_CWD='/work/app' claude",
        screen: '',
      },
    },
    sessionId: 'lx1',
  })
  service.handleToolCall({
    toolName: 'bash',
    input: {},
    result: {
      content: '',
      details: { action: 'screen', terminalId: 't1', screen: 'a screen no rule matches' },
    },
    sessionId: 'lx1',
  })
  // Correlation normally happens on a delay; the test names the transcript directly.
  service.live.adopt('t1', SESSION_ID)
  return { service, key: `claude-code:${SESSION_ID}`, transcript: join(dir, `${SESSION_ID}.jsonl`) }
}

describe('a wait consults the log before deciding it is already over', () => {
  test('the screen alone leaves the delegation looking settled', async () => {
    const { service, key } = await serviceWith(MID_TURN)

    // The starting point: no rule matched, so the state is the fallback and `idle` is in the
    // default target set. This is what used to end the wait.
    const explain = await service.explain(key)
    expect(explain?.state).toBe('idle')
    expect(explain?.fallbackReason).toBeDefined()
  })

  test('a mid-turn log keeps the wait open until its timeout', async () => {
    const { service, key } = await serviceWith(MID_TURN)

    const outcome = await service.wait({
      keys: [key],
      mode: 'all',
      until: ['idle', 'done', 'blocked'],
      timeoutMs: 1_000,
    })

    expect(outcome.timedOut).toBe(true)
    expect(outcome.satisfied).toBe(false)
    expect(outcome.states[key]).toBe('working')
    // And the answer is a reading now, not a guess with a stated reason.
    expect(outcome.degraded).toEqual([])
    service.shutdown()
  })

  test('a turn that ends DURING the wait ends the wait', async () => {
    // The other half of the wiring: the pre-wait read answers "was it already over", the ticks
    // answer "is it over now". Without them a delegation that finishes mid-wait is only noticed at
    // the next roster — which, during a wait, is never.
    const { service, key, transcript } = await serviceWith(MID_TURN)
    setTimeout(() => {
      void writeFile(transcript, FINISHED.map((r) => JSON.stringify(r)).join('\n'), 'utf8')
    }, 200)

    const outcome = await service.wait({
      keys: [key],
      mode: 'all',
      until: ['idle', 'done', 'blocked'],
      timeoutMs: 12_000,
    })

    expect(outcome.satisfied).toBe(true)
    expect(outcome.timedOut).toBe(false)
    service.shutdown()
  }, 20_000)

  test('a turn that ends during the wait is read from the log’s change, not a tick later', async () => {
    // The tick alone noticed it up to WAIT_POLL_MS (2 s) late; the log has a change event.
    const { service, key, transcript } = await serviceWith(MID_TURN)
    let wroteAt = 0
    setTimeout(() => {
      wroteAt = Date.now()
      void writeFile(transcript, FINISHED.map((r) => JSON.stringify(r)).join('\n'), 'utf8')
    }, 150)

    const outcome = await service.wait({
      keys: [key],
      mode: 'all',
      until: ['idle', 'done', 'blocked'],
      timeoutMs: 12_000,
    })

    expect(outcome.satisfied).toBe(true)
    expect(Date.now() - wroteAt).toBeLessThan(1_500)
    service.shutdown()
  }, 20_000)

  test('a wait finds the log once, not by listing the history on every tick', async () => {
    // `findSource` enumerates a provider's whole history; a wait asked it for each key per tick.
    const { service, key } = await serviceWith(MID_TURN)
    const adapter = adapterFor('claude-code')!
    const listing = spyOn(adapter, 'listSources')
    try {
      await service.wait({
        keys: [key],
        mode: 'all',
        until: ['idle', 'done', 'blocked'],
        timeoutMs: 4_500,
      })
      expect(listing).toHaveBeenCalledTimes(1)
    } finally {
      listing.mockRestore()
      service.shutdown()
    }
  }, 20_000)

  test('a finished log settles it at once, so nothing waits on an idle agent', async () => {
    const { service, key } = await serviceWith(FINISHED)

    const started = Date.now()
    const outcome = await service.wait({
      keys: [key],
      mode: 'all',
      until: ['idle', 'done', 'blocked'],
      timeoutMs: 30_000,
    })

    expect(outcome.satisfied).toBe(true)
    expect(outcome.timedOut).toBe(false)
    expect(Date.now() - started).toBeLessThan(2_000)
    service.shutdown()
  })
})

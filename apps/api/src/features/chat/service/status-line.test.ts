import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { routedParticipants, sessionFixture } from '../../../testing/session-fixture'
import type { SessionRecord } from '../repository'
import { createStatusLine } from './status-line'

/**
 * The `statusLine` command of a person's Claude Code settings draws the line under a
 * conversation's message box, as it draws Claude Code's (statusline.md): it reads the session as
 * JSON on stdin, and what it prints — colors and links stripped, rows joined — is the line.
 */
const scratch = tempDirPerTest('cc-status-line-')

/** Timers a test fires by hand. */
function manualTimers() {
  const pending = new Map<number, () => void>()
  let next = 0
  return {
    timers: {
      set: (run: () => void) => {
        pending.set(++next, run)
        return next
      },
      clear: (handle: unknown) => pending.delete(handle as number),
    },
    fire: () => {
      const runs = [...pending.values()]
      pending.clear()
      for (const run of runs) run()
    },
  }
}

function harness(statusLine: Record<string, unknown> | undefined) {
  const root = scratch()
  const cwd = join(root, 'project')
  writeTree(root, {
    'home/.claude/settings.json': JSON.stringify(statusLine ? { statusLine } : {}),
    'project/.keep': '',
  })
  const session: SessionRecord = sessionFixture({
    id: 'S-1',
    userId: 'u1',
    seq: 1,
    title: 'Fix the parser',
    agents: routedParticipants({ modelId: 'claude-opus-5-5' }),
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    lastMessageAt: '2026-01-01 00:00:00',
    rootSessionId: 'S-1',
    permissionMode: 'plan',
  })
  const published: Array<string | undefined> = []
  const clock = manualTimers()
  const line = createStatusLine({
    requireSession: async () => session,
    resolveSessionWorkingDir: async () => cwd,
    usage: async () => ({
      totalCost: 0.25,
      inputTokens: 1200,
      outputTokens: 300,
      context: { used: 20_000, size: 200_000 },
    }),
    publish: (_sessionId, text) => published.push(text),
    watched: () => true,
    homeDir: join(root, 'home'),
    env: {},
    managed: null,
    timers: clock.timers,
  })
  return { root, cwd, line, published, clock }
}

describe("Claude Code's statusLine under the message box", () => {
  test('the command reads the session on stdin; its output is the line', async () => {
    const { root, cwd, line, published } = harness({
      type: 'command',
      command:
        `cat > '${'IN'}'; printf '\\033[32m%s\\033[0m\\nrow two' "$(basename "$PWD")"`.replace(
          'IN',
          join(scratch(), 'stdin.json'),
        ),
    })
    await line.refresh('u1', 'S-1')
    expect(published).toEqual(['project · row two'])
    const input = JSON.parse(readFileSync(join(root, 'stdin.json'), 'utf8'))
    expect(input).toMatchObject({
      session_id: 'S-1',
      session_name: 'Fix the parser',
      cwd,
      workspace: { current_dir: cwd, project_dir: cwd, added_dirs: [] },
      model: { id: 'claude-opus-5-5' },
      cost: { total_cost_usd: 0.25 },
      context_window: { context_window_size: 200_000, used_percentage: 10 },
    })
  })

  test('a change redraws it once, 300 ms later; no setting, no line', async () => {
    const { line, published, clock } = harness({ type: 'command', command: 'echo hi' })
    line.changed('u1', 'S-1')
    line.changed('u1', 'S-1')
    expect(published).toEqual([])
    clock.fire()
    await line.settled('u1', 'S-1')
    expect(published).toEqual(['hi'])

    const none = harness(undefined)
    await none.line.refresh('u1', 'S-1')
    expect(none.published).toEqual([undefined])
  })

  test('a failing command clears the line', async () => {
    const { line, published } = harness({ type: 'command', command: 'exit 3' })
    await line.refresh('u1', 'S-1')
    expect(published).toEqual([undefined])
  })
})

test('opening a conversation draws it once', async () => {
  const { line, published, clock } = harness({ type: 'command', command: 'echo opened' })
  line.viewed('u1', 'S-1')
  line.viewed('u1', 'S-1')
  clock.fire()
  await line.settled('u1', 'S-1')
  line.viewed('u1', 'S-1')
  clock.fire()
  expect(published).toEqual(['opened'])
})

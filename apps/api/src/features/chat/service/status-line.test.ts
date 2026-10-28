import { describe, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { routedAgent, sessionFixture } from '../../../testing/session-fixture'
import type { SessionRecord } from '../repository'
import { createStatusLine, type StatusLineDeps, type StatusLineUsage } from './status-line'

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

const NO_USAGE = { totalCost: 0.25 }
const LAST_REQUEST = {
  inputTokens: 20_000,
  outputTokens: 500,
  cacheReadTokens: 12_000,
  cacheWriteTokens: 3_000,
}

interface HarnessOptions {
  usage?: StatusLineUsage
  session?: Partial<SessionRecord>
  workspace?: StatusLineDeps['workspace']
  modelInfo?: StatusLineDeps['modelInfo']
  watchSettings?: StatusLineDeps['watchSettings']
  run?: StatusLineDeps['run']
  /** Is a client rendering the conversation; read at each call, so a test can flip it. */
  watched?: () => boolean
  /** Holds the session lookup until it resolves. */
  gate?: Promise<void>
}

function harness(statusLine: Record<string, unknown> | undefined, options: HarnessOptions = {}) {
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
    agent: routedAgent({ modelId: 'claude-opus-5-5' }),
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    lastMessageAt: '2026-01-01 00:00:00',
    rootSessionId: 'S-1',
    permissionMode: 'plan',
    ...options.session,
  })
  const published: Array<string | undefined> = []
  const clock = manualTimers()
  const line = createStatusLine({
    requireSession: async () => {
      await options.gate
      return session
    },
    resolveSessionWorkingDir: async () => cwd,
    usage: async () => options.usage ?? NO_USAGE,
    publish: (_sessionId, text) => published.push(text),
    watched: options.watched ?? (() => true),
    homeDir: join(root, 'home'),
    env: {},
    managed: null,
    timers: clock.timers,
    ...(options.workspace ? { workspace: options.workspace } : { workspace: async () => ({}) }),
    ...(options.modelInfo ? { modelInfo: options.modelInfo } : {}),
    ...(options.watchSettings ? { watchSettings: options.watchSettings } : {}),
    ...(options.run ? { run: options.run } : {}),
    transcriptPath: async () => '/data/S-1.jsonl',
  })
  const settingsFile = join(root, 'home', '.claude', 'settings.json')
  return { root, cwd, line, published, clock, settingsFile, session }
}

/** What the command receives: it writes its stdin where the test can read it. */
async function stdinOf(
  options: HarnessOptions,
  extra: Record<string, unknown> = {},
  // oxlint-disable-next-line typescript/no-explicit-any -- a JSON document read field by field
): Promise<Record<string, any>> {
  const out = join(scratch(), 'stdin.json')
  const { line } = harness(
    { type: 'command', command: `cat > '${out}'; echo ok`, ...extra },
    options,
  )
  await line.refresh('u1', 'S-1')
  return JSON.parse(readFileSync(out, 'utf8'))
}

describe("Claude Code's statusLine: what the command receives", () => {
  test('the model, folder, session and cost as Claude Code names them', async () => {
    const input = await stdinOf({
      modelInfo: async () => ({ name: 'Claude Opus 5.5', contextLength: 200_000 }),
      workspace: async () => ({
        repo: { host: 'github.com', owner: 'rsaryev', name: 'localix' },
        worktree: 'feature-x',
      }),
      session: { outputStyle: 'Explanatory' },
    })
    const cwd = input.cwd
    expect(input).toMatchObject({
      session_id: 'S-1',
      session_name: 'Fix the parser',
      transcript_path: '/data/S-1.jsonl',
      model: { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' },
      workspace: {
        current_dir: cwd,
        project_dir: cwd,
        added_dirs: [],
        git_worktree: 'feature-x',
        repo: { host: 'github.com', owner: 'rsaryev', name: 'localix' },
      },
      output_style: { name: 'Explanatory' },
      cost: { total_cost_usd: 0.25 },
      fast_mode: false,
      effort: { level: 'medium' },
      thinking: { enabled: true },
    })
    expect(typeof input.version).toBe('string')
    expect(input.cost.total_duration_ms).toBeGreaterThan(0)
    // Not known here, so not sent: a script reads each as absent.
    for (const key of ['pr', 'worktree', 'vim', 'rate_limits', 'agent', 'prompt_cache'])
      expect(input).not.toHaveProperty(key)
    expect(input.cost).not.toHaveProperty('total_lines_added')
    expect(input.cost).not.toHaveProperty('total_api_duration_ms')
  })

  test('the display name falls back to the id when the catalog does not know the model', async () => {
    const input = await stdinOf({})
    expect(input.model).toEqual({ id: 'claude-opus-5-5', display_name: 'claude-opus-5-5' })
  })

  test('context: per-call usage, input-only percentage, and totals of the last response', async () => {
    const input = await stdinOf({
      usage: { totalCost: 1, lastRequest: LAST_REQUEST, contextSize: 200_000 },
    })
    expect(input.context_window).toEqual({
      // Input includes cache reads and writes; output is the last response's own.
      total_input_tokens: 20_000,
      total_output_tokens: 500,
      context_window_size: 200_000,
      used_percentage: 10,
      remaining_percentage: 90,
      current_usage: {
        input_tokens: 5_000,
        output_tokens: 500,
        cache_creation_input_tokens: 3_000,
        cache_read_input_tokens: 12_000,
      },
    })
    expect(input.exceeds_200k_tokens).toBe(false)
  })

  test('context size falls back to the model catalog; output never counts toward the percentage', async () => {
    const input = await stdinOf({
      usage: {
        lastRequest: {
          inputTokens: 100_000,
          outputTokens: 150_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      },
      modelInfo: async () => ({ contextLength: 1_000_000 }),
    })
    expect(input.context_window.context_window_size).toBe(1_000_000)
    expect(input.context_window.used_percentage).toBe(10)
    expect(input.exceeds_200k_tokens).toBe(true)
  })

  test('before the first call, and after a compaction, the usage is null', async () => {
    for (const usage of [
      { contextSize: 200_000 },
      { contextSize: 200_000, lastRequest: LAST_REQUEST, compacted: true },
    ]) {
      const { context_window } = await stdinOf({ usage })
      expect(context_window).toMatchObject({
        total_input_tokens: 0,
        total_output_tokens: 0,
        used_percentage: null,
        remaining_percentage: null,
        current_usage: null,
      })
    }
  })

  test('the prompt cache is reported from what the session recorded, and only that', async () => {
    const input = await stdinOf({
      usage: { cache: { hitRatio: 0.75, writeTokens: 9_000, observed: true } },
    })
    // No request yet: nothing is cached to be warm, nothing to re-send.
    expect(input.prompt_cache).toEqual({
      warm: false,
      caching_observed: true,
      ttl: '5m',
      expires_at: null,
      hit_ratio: 0.75,
      cache_write_tokens: 9_000,
      recache_tokens_if_cold: null,
    })
  })

  describe('whether the cache is warm, as the line under Claude Code reads it', () => {
    // A script written for Claude Code prints "cold" for anything but `warm: true`, and sizes the
    // re-send from `recache_tokens_if_cold`: both come from the LAST response, not the session.
    const cache = (extra: Record<string, unknown>) => ({
      hitRatio: 0.4,
      writeTokens: 0,
      observed: true,
      ...extra,
    })

    test('warm until the last response is older than the cache lifetime, as Claude Code counts it', async () => {
      const at = Date.now() - 60_000
      const input = await stdinOf({
        usage: { lastRequest: LAST_REQUEST, cache: cache({ lastResponseAt: at }) },
      })
      expect(input.prompt_cache).toMatchObject({
        warm: true,
        ttl: '5m',
        expires_at: Math.floor((at + 5 * 60_000) / 1000),
        recache_tokens_if_cold: 20_000,
      })

      const cold = await stdinOf({
        usage: {
          lastRequest: LAST_REQUEST,
          cache: cache({ lastResponseAt: Date.now() - 6 * 60_000 }),
        },
      })
      expect(cold.prompt_cache).toMatchObject({ warm: false, recache_tokens_if_cold: 20_000 })
      expect(cold.prompt_cache.expires_at).toBeLessThan(Date.now() / 1000)
    })

    test('the one-hour cache lives an hour', async () => {
      const at = Date.now() - 30 * 60_000
      const input = await stdinOf({
        usage: {
          lastRequest: LAST_REQUEST,
          cache: cache({ lastResponseAt: at, longLived: true }),
        },
      })
      expect(input.prompt_cache).toMatchObject({
        warm: true,
        ttl: '1h',
        expires_at: Math.floor((at + 60 * 60_000) / 1000),
      })
    })

    test('a last response that read and wrote nothing is cold, whatever the session cached before', async () => {
      const input = await stdinOf({
        usage: {
          lastRequest: { ...LAST_REQUEST, cacheReadTokens: 0, cacheWriteTokens: 0 },
          cache: cache({ lastResponseAt: Date.now() - 1_000 }),
        },
      })
      expect(input.prompt_cache).toMatchObject({
        warm: false,
        caching_observed: true,
        expires_at: null,
        recache_tokens_if_cold: 20_000,
      })
    })

    test('after a compaction there is nothing to re-send until the next request sizes it', async () => {
      const input = await stdinOf({
        usage: {
          lastRequest: LAST_REQUEST,
          compacted: true,
          cache: cache({ lastResponseAt: Date.now() - 1_000 }),
        },
      })
      expect(input.prompt_cache).toMatchObject({
        warm: false,
        expires_at: null,
        recache_tokens_if_cold: null,
      })
    })
  })

  test('the prompt being answered and the agent a conversation runs as', async () => {
    const input = await stdinOf({
      usage: { promptId: '550e8400-e29b-41d4-a716-446655440000' },
      session: { agent: routedAgent({ modelId: 'm', name: 'security-reviewer' }) },
    })
    expect(input.prompt_id).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(input.agent).toEqual({ name: 'security-reviewer' })
  })

  test('thinking is off when the route reasons at no level', async () => {
    const input = await stdinOf({
      session: { agent: routedAgent({ modelId: 'm', reasoningEffort: 'off' as never }) },
    })
    expect(input.thinking).toEqual({ enabled: false })
    expect(input).not.toHaveProperty('effort')
  })
})

describe("Claude Code's statusLine: what it prints", () => {
  test('each printed row is its own row, with colors and links kept for the screen', async () => {
    const { line, published } = harness({
      type: 'command',
      command: `printf '\\033[32mgreen\\033[0m  bar\\n\\033]8;;https://example.com\\007site\\033]8;;\\007\\n\\n'`,
    })
    await line.refresh('u1', 'S-1')
    expect(published).toEqual([
      '\u001b[32mgreen\u001b[0m  bar\n\u001b]8;;https://example.com\u001b\\site\u001b]8;;\u001b\\',
    ])
  })

  test('cursor moves, titles and other control bytes never reach the screen', async () => {
    const { line, published } = harness({
      type: 'command',
      command: `printf 'a\\033[2Jb\\033]0;title\\007c\\033[1;31md\\033[0m\\001\\n'`,
    })
    await line.refresh('u1', 'S-1')
    expect(published).toEqual(['abc\u001b[1;31md\u001b[0m'])
  })

  test('padding indents every row', async () => {
    const { line, published } = harness({
      type: 'command',
      command: 'echo one; echo two',
      padding: 2,
    })
    await line.refresh('u1', 'S-1')
    expect(published).toEqual(['  one\n  two'])
  })

  test('a failing or silent command clears the line', async () => {
    for (const command of ['exit 3', 'true', 'echo; echo']) {
      const { line, published } = harness({ type: 'command', command })
      await line.refresh('u1', 'S-1')
      expect(published).toEqual([undefined])
    }
  })
})

describe("Claude Code's statusLine: when it runs", () => {
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

  test('a changed command runs at once, without the debounce; another setting waits for it', async () => {
    let onChange: () => void = () => {}
    const { line, published, clock, settingsFile } = harness(
      { type: 'command', command: 'echo old' },
      { watchSettings: (_dirs, run) => ((onChange = run), () => {}) },
    )
    await line.refresh('u1', 'S-1')
    writeFileSync(
      settingsFile,
      JSON.stringify({ statusLine: { type: 'command', command: 'echo new' } }),
    )
    onChange()
    await line.settled('u1', 'S-1')
    expect(published).toEqual(['old', 'new'])

    writeFileSync(
      settingsFile,
      JSON.stringify({ statusLine: { type: 'command', command: 'echo new', padding: 1 } }),
    )
    onChange()
    await line.settled('u1', 'S-1')
    expect(published).toEqual(['old', 'new'])
    clock.fire()
    await line.settled('u1', 'S-1')
    expect(published).toEqual(['old', 'new', ' new'])
  })

  test('a new update cancels the command still running', async () => {
    const signals: AbortSignal[] = []
    const { line, published } = harness(
      { type: 'command', command: 'echo x' },
      {
        run: (options) => {
          signals.push(options.signal!)
          return signals.length === 1
            ? new Promise(() => {})
            : Promise.resolve({ code: 0, stdout: 'second', stderr: '' } as never)
        },
      },
    )
    void line.refresh('u1', 'S-1')
    await Promise.resolve()
    await new Promise((resolve) => setImmediate(resolve))
    await line.refresh('u1', 'S-1')
    expect(signals[0]?.aborted).toBe(true)
    expect(published).toEqual(['second'])
  })
})

describe("Claude Code's statusLine: only for a conversation somebody renders", () => {
  test('a change in a conversation nobody watches runs nothing and watches nothing', async () => {
    let runs = 0
    let watches = 0
    const { line, published, clock } = harness(
      { type: 'command', command: 'echo hi' },
      {
        watched: () => false,
        run: async () => {
          runs++
          return { code: 0, stdout: 'x', stderr: '' } as never
        },
        watchSettings: () => (watches++, () => {}),
      },
    )
    line.changed('u1', 'S-1')
    clock.fire()
    await line.settled('u1', 'S-1')
    expect({ runs, watches, published }).toEqual({ runs: 0, watches: 0, published: [] })
  })

  test('opening a conversation draws it even before its stream is subscribed', async () => {
    const { line, published, clock } = harness(
      { type: 'command', command: 'echo opened' },
      { watched: () => false },
    )
    line.viewed('u1', 'S-1')
    clock.fire()
    await line.settled('u1', 'S-1')
    expect(published).toEqual(['opened'])
  })

  test('a conversation nobody watches any more lets go of its settings watchers', async () => {
    let watched = true
    let stopped = 0
    const { line, clock } = harness(
      { type: 'command', command: 'echo hi' },
      { watched: () => watched, watchSettings: () => () => void stopped++ },
    )
    line.changed('u1', 'S-1')
    clock.fire()
    await line.settled('u1', 'S-1')
    expect(stopped).toBe(0)
    watched = false
    line.changed('u1', 'S-1')
    clock.fire()
    expect(stopped).toBe(1)
  })

  test('a settings edit does not run the command of a conversation nobody watches', async () => {
    let watched = true
    let onChange: () => void = () => {}
    let runs = 0
    const { line, clock } = harness(
      { type: 'command', command: 'echo hi' },
      {
        watched: () => watched,
        watchSettings: (_dirs, run) => ((onChange = run), () => {}),
        run: async () => {
          runs++
          return { code: 0, stdout: 'x', stderr: '' } as never
        },
      },
    )
    line.changed('u1', 'S-1')
    clock.fire()
    await line.settled('u1', 'S-1')
    expect(runs).toBe(1)
    watched = false
    onChange()
    await line.settled('u1', 'S-1')
    clock.fire()
    await line.settled('u1', 'S-1')
    expect(runs).toBe(1)
  })

  test('a conversation deleted while its first draw resolves the settings leaves nothing behind', async () => {
    let release: () => void = () => {}
    let watches = 0
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { line, published } = harness(
      { type: 'command', command: 'echo hi' },
      {
        gate,
        watchSettings: () => (watches++, () => {}),
      },
    )
    const drawing = line.refresh('u1', 'S-1')
    line.deleted('u1', 'S-1')
    release()
    await drawing
    expect({ watches, published }).toEqual({ watches: 0, published: [] })
  })
})

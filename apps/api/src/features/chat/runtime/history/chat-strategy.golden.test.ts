/**
 * THE GOLDEN WIRE: what the chat strategy hands the model on the history shapes the previous
 * three-layer pipeline was written against, recorded byte for byte BEFORE that pipeline was
 * deleted (its parity test proved the two agreed on every shape here).
 *
 * If this file goes red, the bytes the provider sees changed — and with them its prefix cache
 * and possibly its answers. That is sometimes the intent (a stage was deliberately reworked);
 * then re-record with `UPDATE_GOLDEN=1 bun test chat-strategy.golden` and say so in the commit.
 * To SEE the new bytes first, run with `GOLDEN_DUMP_DIR=<dir>` and diff against a dump from
 * `main`. It is never an accident to be silenced.
 */
import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { PersistedMessage } from '../../contracts'
import type { RunnerDeps } from '../agent-runner-types'
import { resolveContextBudgetFrame } from '../context-budget'
import { createChatHistoryRun } from './chat-strategy'
import { intakeTurn } from './intake'
import { freshLane, freshView } from './test-fixtures'

const NOW = '2026-09-04T00:00:00.000Z'
const GOLDEN_PATH = path.join(import.meta.dir, 'chat-strategy.golden.json')

/**
 * `toModelMessages` stamps the wall clock on each message; the provider never sees it. The
 * recording keeps a DIGEST of the bytes, not the bytes (a megabyte of fixture per shape would
 * be noise in every diff); `GOLDEN_DUMP_DIR` writes the fresh wire out so a change can be read.
 */
const bytes = (value: unknown): string =>
  JSON.stringify(value, (key, v) => (key === 'timestamp' ? undefined : v))
const digest = (value: unknown): string => createHash('sha256').update(bytes(value)).digest('hex')

function row(id: string, payload: Record<string, unknown>): PersistedMessage {
  return {
    id,
    sessionId: 's1',
    userId: 'u1',
    payload: { id, ...payload },
    createdAt: NOW,
    updatedAt: NOW,
  } as unknown as PersistedMessage
}

const user = (id: string, content: string, extra: Record<string, unknown> = {}) =>
  row(id, { role: 'user', content, ...extra })

const readTurn = (i: number, lines = 400) =>
  row(`m-${i}`, {
    role: 'assistant',
    content: '',
    items: [
      {
        type: 'tool_call',
        toolCallId: `t-${i}`,
        name: 'read',
        status: 'completed',
        input: { path: `/repo/src/file-${i}.ts` },
        resultText: `line ${i}\n`.repeat(lines),
      },
    ],
  })

const bashTurn = (i: number) =>
  row(`b-${i}`, {
    role: 'assistant',
    content: '',
    items: [
      {
        type: 'tool_call',
        toolCallId: `bt-${i}`,
        name: 'bash',
        status: 'completed',
        input: { command: `test ${i}` },
        resultText: `out ${i} xxxxxxxxxxxxxxxx\n`.repeat(300),
      },
    ],
  })

const GOLDEN_SHAPES: Record<string, () => PersistedMessage[]> = {
  'short chat': () => [
    user('u-1', 'hi'),
    row('a-1', { role: 'assistant', content: 'hello' }),
    user('u-2', 'more'),
  ],
  'ui-only rows are dropped': () => [
    user('u-1', 'first'),
    user('marker', 'Mode changed', { uiOnly: true }),
    user('u-2', 'prompt'),
  ],
  'long recoverable tool history under a small window': () => [
    user('u-0', 'Inspect the repository and fix the issue.'),
    ...Array.from({ length: 60 }, (_, i) => readTurn(i)),
    user('u-end', 'Continue from the evidence above.'),
  ],
  'mixed recoverable and non-recoverable output': () => [
    user('u-0', 'start'),
    ...Array.from({ length: 20 }, (_, i) => (i % 3 === 0 ? bashTurn(i) : readTurn(i))),
    user('u-end', 'go on'),
  ],
  'a /clear boundary cuts what came before': () => [
    user('u-old', 'the cleared conversation'),
    row('a-old', { role: 'assistant', content: 'old answer' }),
    row('clear-1', { role: 'user', content: '/clear', isInternal: true, contextBoundary: true }),
    user('u-new', 'after the clear'),
  ],
  'a trailing steer that was never answered inline': () => [
    user('u-0', 'task'),
    row('a-0', { role: 'assistant', content: 'working' }),
    user('steer', 'also do X', { origin: 'user-steer' }),
    user('u-end', 'status?'),
  ],
}

const WINDOWS = [32_000, 200_000] as const
const TAIL = '# Runtime context\nToday is 2026-09-04.'

interface GoldenEntry {
  wireSha256: string
  estimate: { tokens: number; source: string }
  prunedSha256: string
  elidedToolCallIds: string[]
}

async function materializeGolden(
  history: PersistedMessage[],
  window: number,
  tail: string,
): Promise<GoldenEntry> {
  const deps = { lspManager: undefined, mediaStore: undefined } as unknown as RunnerDeps
  const frame = resolveContextBudgetFrame({ contextWindow: window, fixedOverheadTokens: 1_000 })
  const intake = await intakeTurn({
    deps,
    userId: 'u1',
    session: { id: 's1' } as never,
    assistantMessageId: 'asst-1',
    assistantCreatedAt: NOW,
    historyMessages: history,
    loadedPlugins: { hooks: [] } as never,
    ccHooks: { active: false } as never,
    ccSessionStartContext: undefined,
    runtimeSections: tail ? [{ key: 'runtime', scope: 'state', text: tail }] : [],
    defaultCwd: '/tmp/golden',
    now: () => NOW,
  })
  if (!intake.ok) throw new Error('unexpected block')
  const ledger = freshLane()
  const run = createChatHistoryRun({
    sessionId: 's1',
    frame,
    identity: { providerId: 'p', modelId: 'm', systemPromptHash: 'sp', toolSchemaHash: 'ts' },
    view: freshView(),
    recoveryToolAvailable: true,
    media: { defaultCwd: '/tmp/golden' },
    state: ledger,
  })
  const out = await run.materialize(intake.frame, new AbortController().signal)
  const pruned = await run
    .requestPolicy({ initialEstimate: out.estimate })
    .transform(out.wire, new AbortController().signal)
  if (process.env.GOLDEN_DUMP_DIR) {
    const slug = `${history.length}-${window}-${tail ? 'tail' : 'notail'}`
    writeFileSync(path.join(process.env.GOLDEN_DUMP_DIR, `${slug}.wire.json`), bytes(out.wire))
    writeFileSync(path.join(process.env.GOLDEN_DUMP_DIR, `${slug}.pruned.json`), bytes(pruned))
  }
  return {
    wireSha256: digest(out.wire),
    estimate: { tokens: out.estimate.tokens, source: out.estimate.source },
    prunedSha256: digest(pruned),
    elidedToolCallIds: [...ledger.elidedToolCallIds].sort(),
  }
}

const keyOf = (name: string, window: number, tail: string) =>
  `${name} @ ${window}${tail ? '' : ' (no tail)'}`

async function recordAll(): Promise<Record<string, GoldenEntry>> {
  const out: Record<string, GoldenEntry> = {}
  for (const [name, build] of Object.entries(GOLDEN_SHAPES)) {
    for (const window of WINDOWS) {
      out[keyOf(name, window, TAIL)] = await materializeGolden(build(), window, TAIL)
    }
  }
  out[keyOf('short chat', 128_000, '')] = await materializeGolden(
    GOLDEN_SHAPES['short chat']!(),
    128_000,
    '',
  )
  return out
}

if (process.env.UPDATE_GOLDEN === '1') {
  test('records the golden wire', async () => {
    writeFileSync(GOLDEN_PATH, `${JSON.stringify(await recordAll(), null, 2)}\n`)
  })
} else {
  const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as Record<string, GoldenEntry>

  describe('chat-hybrid hands the model the recorded bytes', () => {
    test('the recording covers every shape × window (and nothing else)', () => {
      const expected = [
        ...Object.keys(GOLDEN_SHAPES).flatMap((name) =>
          WINDOWS.map((window) => keyOf(name, window, TAIL)),
        ),
        keyOf('short chat', 128_000, ''),
      ].sort()
      expect(Object.keys(golden).sort()).toEqual(expected)
    })

    for (const [name, build] of Object.entries(GOLDEN_SHAPES)) {
      for (const window of WINDOWS) {
        test(keyOf(name, window, TAIL), async () => {
          const fresh = await materializeGolden(build(), window, TAIL)
          expect(fresh).toEqual(golden[keyOf(name, window, TAIL)]!)
        })
      }
    }

    test(keyOf('short chat', 128_000, ''), async () => {
      const fresh = await materializeGolden(GOLDEN_SHAPES['short chat']!(), 128_000, '')
      expect(fresh).toEqual(golden[keyOf('short chat', 128_000, '')]!)
    })
  })
}

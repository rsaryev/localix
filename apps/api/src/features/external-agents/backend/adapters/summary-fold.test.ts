import { describe, expect, test } from 'bun:test'
import { mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { foldClaudeCode } from './claude-summary'
import { foldCodex } from './codex-summary'
import { foldJsonlFrom, revisionOf } from './fs-read'
import type { FoldedSummary, SourceRef } from './types'

const SESSION = '019fbea7-a356-75a0-8d14-c3362752cc71'

async function file(text: string): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), 'summary-fold-')), `${SESSION}.jsonl`)
  await writeFile(path, text, 'utf8')
  return path
}

async function refOf(path: string): Promise<SourceRef> {
  const info = await stat(path)
  return {
    nativeSessionId: SESSION,
    sourcePath: path,
    revision: revisionOf(info.mtimeMs, info.size),
    sourceBytes: info.size,
    updatedAtHint: 1,
  }
}

/** Write the file up to each cut in turn, folding from the previous fold every time. */
async function foldInSteps(
  fold: (ref: SourceRef, previous: FoldedSummary | undefined) => Promise<FoldedSummary>,
  text: string,
  cuts: readonly number[],
): Promise<{ stepped: FoldedSummary; whole: FoldedSummary }> {
  const path = await file('')
  let stepped: FoldedSummary | undefined
  for (const cut of [...cuts, text.length]) {
    await writeFile(path, text.slice(0, cut), 'utf8')
    stepped = await fold(await refOf(path), stepped)
  }
  return { stepped: stepped!, whole: await fold(await refOf(path), undefined) }
}

function assistant(id: string, output: number, at: string, model = 'claude-opus-4-8'): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: at,
    message: {
      id,
      role: 'assistant',
      model,
      content: 'é ✓',
      usage: { input_tokens: 10, cache_read_input_tokens: 30, output_tokens: output },
    },
  })
}

const CLAUDE = [
  JSON.stringify({
    type: 'user',
    uuid: 'u1',
    cwd: '/work/app',
    timestamp: '2026-08-01T10:00:00.000Z',
    message: { role: 'user', content: 'Fix the parser' },
  }),
  assistant('request-1', 2, '2026-08-01T10:01:00.000Z'),
  // The same request again, still streaming: its final output count is the one that counts.
  assistant('request-1', 12, '2026-08-01T10:01:01.000Z'),
  JSON.stringify({ type: 'user', uuid: 'u2', message: { role: 'user', content: 'More' } }),
  assistant('request-2', 8, '2026-08-02T10:00:00.000Z', 'claude-sonnet-4-6'),
].join('\n')

describe('append-only summary folds', () => {
  test('stop after the last whole line, and leave a fragment for the next fold', async () => {
    const path = await file('{"a":1}\n{"b":2}\n{"c":')
    const seen: unknown[] = []
    const offset = await foldJsonlFrom(
      path,
      0,
      100,
      () => true,
      (record) => seen.push(record),
    )
    expect(seen).toEqual([{ a: 1 }, { b: 2 }])
    expect(offset).toBe('{"a":1}\n{"b":2}\n'.length)
  })

  test('Claude Code: folding an appended transcript in steps equals folding it whole', async () => {
    const at = (needle: string) => CLAUDE.indexOf(needle)
    // One cut between the two readings of request-1, one in the middle of a multibyte line.
    const cuts = [at('{"type":"assistant","timestamp":"2026-08-01T10:01:01'), at('✓') + 1]
    const { stepped, whole } = await foldInSteps(
      (ref, previous) => foldClaudeCode(ref, previous),
      CLAUDE,
      cuts,
    )
    expect(stepped.summary).toEqual(whole.summary)
    expect(whole.summary.messageCount).toBe(4)
    expect(whole.summary.usage?.outputTokens).toBe(20)
  })

  test('Codex: folding an appended rollout in steps equals folding it whole', async () => {
    const count = (total: number, at: string) =>
      JSON.stringify({
        type: 'event_msg',
        timestamp: at,
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: { input_tokens: total, output_tokens: 1, total_tokens: total + 1 },
          },
        },
      })
    const text = [
      JSON.stringify({ type: 'session_meta', payload: { id: SESSION, cwd: '/work/app' } }),
      JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.5' } }),
      count(100, '2026-08-03T10:00:00.000Z'),
      count(250, '2026-08-03T10:05:00.000Z'),
      count(400, '2026-08-04T10:05:00.000Z'),
    ].join('\n')
    const cuts = [text.indexOf('{"type":"event_msg"'), text.lastIndexOf('{"type":"event_msg"')]
    const { stepped, whole } = await foldInSteps(
      (ref, previous) => foldCodex(ref, previous),
      text,
      cuts,
    )
    expect(stepped.summary).toEqual(whole.summary)
    // Cumulative counters: the cut must not charge the first segment twice.
    expect(whole.summary.usage?.totalTokens).toBe(401)
  })

  test('a file rewritten under the same name is folded again from its start', async () => {
    const path = await file(CLAUDE)
    const first = await foldClaudeCode(await refOf(path), undefined)
    const rewritten = CLAUDE.replace('"output_tokens":8', '"output_tokens":9') + '\n'
    await writeFile(path, rewritten, 'utf8')
    const again = await foldClaudeCode(await refOf(path), first)
    expect(again.summary).toEqual((await foldClaudeCode(await refOf(path), undefined)).summary)
    expect(again.summary.usage?.outputTokens).toBe(21)
  })
})

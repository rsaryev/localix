import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { renderBackgroundStartResult } from './bash-background-result'
import {
  createBoundedOutput,
  modelFacingOutput,
  spillFullOutput,
  spillReaped,
  truncate,
  MAX_OUTPUT_BYTES,
} from './bash-output'

let dir: string | undefined
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

describe('spillFullOutput', () => {
  test('writes the full output to a file and returns its path', async () => {
    dir = await mkdtemp(join(tmpdir(), 'bash-spill-'))
    const big = 'line\n'.repeat(20_000)
    const path = await spillFullOutput(big, 'call-1', dir)
    expect(path).not.toBeNull()
    expect(await readFile(path!, 'utf8')).toBe(big)
  })

  test('sanitizes the key into a safe filename', async () => {
    dir = await mkdtemp(join(tmpdir(), 'bash-spill-'))
    const path = await spillFullOutput('x', '../..//evil name', dir)
    expect(path).not.toBeNull()
    expect(path!.startsWith(dir)).toBe(true)
    expect(path!).not.toContain('..')
  })

  test('reaps spills older than the retention window', async () => {
    dir = await mkdtemp(join(tmpdir(), 'bash-spill-'))
    const stale = join(dir, 'old-1.log')
    await writeFile(stale, 'stale')
    const past = (Date.now() - 72 * 60 * 60 * 1000) / 1000
    await utimes(stale, past, past)
    await spillFullOutput('fresh', 'call-2', dir)
    await spillReaped()
    const names = await readdir(dir)
    expect(names.some((n) => n === 'old-1.log')).toBe(false)
    expect(names.some((n) => n.startsWith('call-2'))).toBe(true)
  })
})

describe('modelFacingOutput spill footer', () => {
  const oversized = Array.from({ length: 3000 }, (_, i) => `output line ${i}`).join('\n')

  test('truncated output names the spill file instead of advising a re-run', () => {
    const out = modelFacingOutput(oversized, { spillPath: '/tmp/spill/abc.log' })
    expect(out).toContain('Complete captured output saved to /tmp/spill/abc.log')
    expect(out).not.toContain('re-run filtered')
  })

  test('without a spill the original re-run advice stays', () => {
    const out = modelFacingOutput(oversized, {})
    expect(out).toContain('re-run filtered')
  })

  test('untruncated output carries no marker at all', () => {
    const out = modelFacingOutput('short output', { spillPath: '/tmp/spill/abc.log' })
    expect(out).toBe('short output')
  })
})

/**
 * The CONTRACT the background paths now depend on. These do not pin the background change itself — they
 * exercise `modelFacingOutput`, which was already honest — but they are the reason it is safe for
 * `bash-background.ts` to delegate to it, so a future edit that makes this marker vague would silently
 * take the background path down with it.
 *
 * What the background paths used to do instead: drop the head behind a bare `…` or `[…truncated…]` with
 * no counts and no spill file, so a 400 KB build whose error was in the first 50 KB reached the model
 * looking exactly like complete output.
 */
describe('a model-facing cap always states what it dropped', () => {
  const big = Array.from({ length: 4000 }, (_, i) => `line ${i}`).join('\n')

  test('the marker names the dropped lines, the totals, and what to do next', () => {
    const out = modelFacingOutput(big, { command: 'npm run build', toolCallId: 'tc1' })
    expect(out).toMatch(/truncated \d[\d,]* lines/)
    expect(out).toMatch(/of 4000 lines/)
    expect(out).toMatch(/re-run filtered|read\/search\/grep/)
  })

  test('a bare ellipsis is not enough — the old background shape is rejected', () => {
    const out = modelFacingOutput(big, { command: 'npm run build', toolCallId: 'tc1' })
    expect(out.startsWith('…\n')).toBe(false)
    expect(out.startsWith('[…truncated…]')).toBe(false)
  })

  test('the tail is what survives — an error at the END is never the part that is cut', () => {
    const out = modelFacingOutput(`${big}\nFINAL ERROR: boom`, {
      command: 'npm run build',
      toolCallId: 'tc1',
    })
    expect(out).toContain('FINAL ERROR: boom')
  })

  test('the immediate result a starting job returns carries a real marker', () => {
    // Behaviour, not a source string: the renderer is a pure function now, so the marker can
    // be observed instead of grepped for.
    const content = renderBackgroundStartResult({
      command: 'bun run build',
      jobId: 'job-1',
      output: 'x'.repeat(20_000),
      earlyExited: false,
      exitCode: null,
      settleMaxMs: 3_000,
    })
    expect(content).toContain('job-1')
    // Real counts and the exact way to read more — a bare ellipsis told the model neither.
    expect(content).toMatch(/showing last \d+ of \d+ lines, [\d.]+(KB|MB|B)/)
    expect(content).toContain('action="read"')
  })

  test('a job that exited before we returned does not tell the model to poll it', () => {
    const content = renderBackgroundStartResult({
      command: 'false',
      jobId: 'job-2',
      output: '',
      earlyExited: true,
      exitCode: 1,
      settleMaxMs: 3_000,
    })
    expect(content).toContain('exited early (exit 1)')
    expect(content).not.toContain('still running')
  })

  test('an adopted job says it outlived its foreground budget', () => {
    // Without this the model reads a missing foreground result as a failure.
    const content = renderBackgroundStartResult({
      command: 'sleep 600',
      jobId: 'job-3',
      output: '',
      earlyExited: false,
      exitCode: null,
      adoptedAfterSecs: 120,
      settleMaxMs: 3_000,
    })
    expect(content).toContain('No result after 120s')
  })
})

describe('createBoundedOutput', () => {
  const eager = (chunks: string[]): string => {
    // The expression this replaces, verbatim: the assertion below is that the retained bytes
    // are the same, so the change is purely about how often the buffer is copied.
    let buffer = ''
    for (const chunk of chunks) buffer = truncate(buffer + chunk)
    return buffer
  }

  const chunked = (total: number, size: number): string[] => {
    const chunks: string[] = []
    for (let i = 0; i < total; i += size) chunks.push(String(i % 10).repeat(size))
    return chunks
  }

  test('below the cap it keeps everything', () => {
    const capture = createBoundedOutput()
    capture.append('one\n')
    capture.append('two\n')
    expect(capture.text()).toBe('one\ntwo\n')
  })

  test('past the cap it retains byte-identical output to the eager expression', () => {
    const chunks = chunked(MAX_OUTPUT_BYTES * 3, 4096)
    const capture = createBoundedOutput()
    for (const chunk of chunks) capture.append(chunk)

    // Amortizing the trim must not change one retained byte: the tail of a stream is the
    // same tail whether it was trimmed on every chunk or once per cap of data.
    expect(capture.text()).toBe(eager(chunks))
  })

  test('the trim runs at most once per cap of data, not once per chunk', () => {
    // The actual defect: a pipe delivers chunks the size of its read buffer, so past the cap
    // the eager form copied the whole retained tail twice for every 4 KB that arrived.
    let slices = 0
    // `Reflect.get`, not a property read: the method is captured deliberately unbound (it is
    // only ever invoked via `.apply(this, …)` below and restored verbatim in `finally`), and a
    // direct `String.prototype.slice` read trips the unbound-method rule that guards accidents.
    const original = Reflect.get(String.prototype, 'slice') as (
      this: string,
      ...args: never[]
    ) => string
    // eslint-disable-next-line no-extend-native -- restored in the same test
    ;(String.prototype as { slice: unknown }).slice = function (this: string, ...args: never[]) {
      slices += 1
      return original.apply(this, args as never)
    } as never
    try {
      const capture = createBoundedOutput()
      for (const chunk of chunked(MAX_OUTPUT_BYTES * 4, 4096)) capture.append(chunk)
      // ~100 append calls; four caps of data means a handful of trims, not one per chunk.
      expect(slices).toBeLessThan(10)
    } finally {
      ;(String.prototype as { slice: unknown }).slice = original
    }
  })

  test('a reader is told bytes were dropped even when the trim landed exactly on the cap', () => {
    // The bug the equivalence test above caught: with the marker driven by CURRENT length, a
    // trim that leaves exactly MAX_OUTPUT_BYTES looks untruncated, and a partial log reads as
    // a complete one. Whether bytes were dropped has to be remembered, not inferred.
    const capture = createBoundedOutput()
    for (const chunk of chunked(MAX_OUTPUT_BYTES * 3, 4096)) capture.append(chunk)
    expect(capture.text()).toStartWith('[…truncated…]\n')
  })

  test('the bounded view is recomputed after new output, not cached stale', () => {
    const capture = createBoundedOutput()
    capture.append('a')
    expect(capture.text()).toBe('a')
    capture.append('b')
    expect(capture.text()).toBe('ab')
  })
})

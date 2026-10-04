import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createReadTool, readDedupStub, READ_DEDUP_STUB_PHRASE, tryListDirectory } from './read'
import { createReadDedupStore } from './read-dedup'
import { createFileMtimeStore } from './file-utils'
import { MAX_DIR_ENTRIES } from './read-output'
import type { ExecutionEnvironment } from '../environment'

describe('createReadTool', () => {
  let tempDir = ''

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'localix-read-'))
  })

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
  })

  test('byte-offset truncation and continuation never split a multi-byte character', async () => {
    // 30k check marks = 90,000 bytes of 3-byte UTF-8 chars; 64,000 is NOT a
    // multiple of 3, so naive slicing would cut through a character at both the
    // tail of the first read and the head of the continuation.
    const content = '✓'.repeat(30_000)
    const filePath = path.join(tempDir, 'multibyte.txt')
    await writeFile(filePath, content, 'utf8')
    const tool = createReadTool(undefined, tempDir)

    const first = await tool.execute('r1', { path: 'multibyte.txt' })
    expect(first.isError).toBeUndefined()
    expect(first.details?.truncated).toBe(true)
    expect(first.content).not.toContain('�')

    // Continue from the suggested offset — it must land on a char boundary.
    const offsetMatch = /offset=(\d+)/.exec(first.content)
    expect(offsetMatch).not.toBeNull()
    const offset = Number(offsetMatch![1])
    expect(offset % 3).toBe(0) // 3-byte chars: a boundary is a multiple of 3

    const second = await tool.execute('r2', { path: 'multibyte.txt', offset })
    expect(second.isError).toBeUndefined()
    expect(second.content).not.toContain('�')
    // No characters lost across the seam: the two slices cover the whole file.
    expect(second.content).toContain('✓')
  })

  test('returns a notice for a binary file instead of garbage bytes', async () => {
    const filePath = path.join(tempDir, 'data.bin')
    // PNG-ish header with an embedded NUL byte → binary by the git heuristic.
    await writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a, 0x0a, 0x42, 0x43]))
    const tool = createReadTool(undefined, tempDir)

    const result = await tool.execute('rb', { path: 'data.bin' })
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('Binary file')
    expect(result.content).toContain('NUL byte')
  })

  test('an image is not read as text — the model is pointed at view_image', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    )
    await writeFile(path.join(tempDir, 'pixel.png'), png)
    const tool = createReadTool(undefined, tempDir)

    const result = await tool.execute('image-read', { path: 'pixel.png' })

    expect(result.isError).toBe(true)
    expect(result.content).toContain('view_image')
    expect(result.contentParts).toBeUndefined()
  })

  test('a misaligned explicit offset is backed up to the previous char boundary', async () => {
    const content = '✓'.repeat(100)
    const filePath = path.join(tempDir, 'aligned.txt')
    await writeFile(filePath, content, 'utf8')
    const tool = createReadTool(undefined, tempDir)

    // Offset 4 points into the middle of the second character (bytes 3-5).
    const result = await tool.execute('r3', { path: 'aligned.txt', offset: 4 })
    expect(result.isError).toBeUndefined()
    expect(result.content).not.toContain('�')
    // Backed up to byte 3 → 99 complete characters remain.
    expect(result.content).toContain('✓'.repeat(99))
  })

  test('startLine/endLine returns exactly the requested line-numbered span', async () => {
    const content = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n')
    await writeFile(path.join(tempDir, 'lines.txt'), content, 'utf8')
    const tool = createReadTool(undefined, tempDir)

    const res = await tool.execute('r4', { path: 'lines.txt', start_line: 3, end_line: 5 })
    expect(res.isError).toBeUndefined()
    expect(res.content).toContain('[') // header names the range
    expect(res.content).toContain('lines 3-5 of 10')
    expect(res.content).toContain('3\tline 3')
    expect(res.content).toContain('5\tline 5')
    // Only the requested span — neighbours excluded.
    expect(res.content).not.toContain('line 2')
    expect(res.content).not.toContain('line 6')
  })

  test('startLine without endLine reads to end of file', async () => {
    const content = Array.from({ length: 6 }, (_, i) => `L${i + 1}`).join('\n')
    await writeFile(path.join(tempDir, 'tail.txt'), content, 'utf8')
    const tool = createReadTool(undefined, tempDir)

    const res = await tool.execute('r5', { path: 'tail.txt', start_line: 5 })
    expect(res.content).toContain('lines 5-6 of 6')
    expect(res.content).toContain('5\tL5')
    expect(res.content).toContain('6\tL6')
    expect(res.content).not.toContain('\tL4')
  })

  test('a trailing newline does not add a phantom final line to the count or output', async () => {
    // "a\nb\nc\n" is 3 lines; split('\n') yields a 4th empty element that must be
    // dropped so the count/numbering match ripgrep and no empty "4<tab>" line renders.
    await writeFile(path.join(tempDir, 'trailing.txt'), 'a\nb\nc\n', 'utf8')
    const tool = createReadTool(undefined, tempDir)

    const res = await tool.execute('r8', { path: 'trailing.txt', start_line: 1 })
    expect(res.content).toContain('lines 1-3 of 3') // not "of 4"
    expect(res.content).toContain('3\tc')
    expect(res.content).not.toContain('4\t') // no phantom empty 4th line
  })

  test('an over-cap line range truncates and advises continuing with startLine (not offset)', async () => {
    // 3000 lines × ~70 bytes ≈ 210KB, well over the 64KB read cap.
    const content = Array.from({ length: 3000 }, (_, i) => `line ${i + 1} ${'x'.repeat(60)}`).join(
      '\n',
    )
    await writeFile(path.join(tempDir, 'big.txt'), content, 'utf8')
    const tool = createReadTool(undefined, tempDir)

    const res = await tool.execute('r7', { path: 'big.txt', start_line: 1, end_line: 3000 })
    expect(res.isError).toBeUndefined()
    expect(res.details?.truncated).toBe(true)
    // Continuation advice must point at startLine — a line-range read ignores offset.
    expect(res.content).toMatch(/Continue with start_line=\d+/)
    expect(res.content).not.toContain('offset=')
    // The advised next line is the one right after the last shown line.
    const m = /start_line=(\d+)/.exec(res.content)
    expect(m).not.toBeNull()
    const next = Number(m![1])
    expect(next).toBeGreaterThan(1)
    expect(res.content).toContain(`${next - 1}\t`) // last shown line is numbered
    expect(res.content).not.toContain(`${next}\tline ${next}`) // next line withheld
  })

  test('startLine past EOF returns a clear notice, not an empty box', async () => {
    await writeFile(path.join(tempDir, 'small.txt'), 'a\nb\nc', 'utf8')
    const tool = createReadTool(undefined, tempDir)

    const res = await tool.execute('r6', { path: 'small.txt', start_line: 99 })
    expect(res.content).toContain('only 3 lines')
    expect(res.content).toContain('start_line=99')
  })

  test('dedup stub is served at most once — a repeat read after the stub re-sends full content', async () => {
    // Guards the endless re-read loop: context compression can evict the earlier read,
    // so a second identical read is the model saying "I no longer have it" — it must
    // get the full file back, not another stub (which pushed it to `bash cat`).
    await writeFile(path.join(tempDir, 'dedup.txt'), 'hello world', 'utf8')
    const tool = createReadTool(undefined, tempDir)

    const first = await tool.execute('d1', { path: 'dedup.txt' })
    expect(first.content).toContain('hello world')

    const second = await tool.execute('d2', { path: 'dedup.txt' })
    expect(second.content).toContain(READ_DEDUP_STUB_PHRASE)

    const third = await tool.execute('d3', { path: 'dedup.txt' })
    expect(third.content).toContain('hello world') // full content again, not a stub

    const fourth = await tool.execute('d4', { path: 'dedup.txt' })
    expect(fourth.content).toContain(READ_DEDUP_STUB_PHRASE) // stub re-armed
  })

  test('a whole-file read clipped by the LINE cap never later serves a "complete" stub', async () => {
    // A file under the 64KB byte cap but over the 2000-line model-facing cap is handed
    // back HEAD-ONLY (modelFacingFile clips it), yet truncateOutput reports truncated:false.
    // The dedup used to arm a whole-file stub anyway, so a repeat read claimed the full
    // content was available "scroll up" — but the tail was never delivered and a plain
    // re-read can never fetch it. It must re-deliver instead (like the byte-cap case).
    const content = Array.from({ length: 2500 }, (_, i) => `line ${i + 1}`).join('\n')
    expect(Buffer.byteLength(content, 'utf8')).toBeLessThan(64_000) // byte cap does NOT trip
    await writeFile(path.join(tempDir, 'many-lines.txt'), content, 'utf8')
    const tool = createReadTool(undefined, tempDir, undefined, undefined, () => false)

    const first = await tool.execute('m1', { path: 'many-lines.txt' })
    expect(first.content).toContain('truncated') // head-only, tail withheld
    expect(first.content).not.toContain('line 2500')

    const second = await tool.execute('m2', { path: 'many-lines.txt' })
    expect(second.content).not.toContain(READ_DEDUP_STUB_PHRASE)
    expect(second.content).toContain('truncated') // the (clipped) content is re-delivered
  })

  test('a repeated LINE RANGE stubs — the same span of an unchanged file is the same bytes', async () => {
    // The ranged branch used to return before any dedup: 498 of the 646 no-change repeat
    // reads on the recorded corpus were ranged, and each re-delivered its slice in full.
    await writeFile(path.join(tempDir, 'range.txt'), 'a\nb\nc\nd\ne\n', 'utf8')
    const tool = createReadTool(undefined, tempDir, undefined, undefined, () => false)

    const first = await tool.execute('r1', { path: 'range.txt', start_line: 2, end_line: 3 })
    expect(first.content).toContain('b')

    const second = await tool.execute('r2', { path: 'range.txt', start_line: 2, end_line: 3 })
    expect(second.content).toContain(READ_DEDUP_STUB_PHRASE)
    expect(second.content).toContain('L2-3')
  })

  test('a DIFFERENT line range is a different window — never stubbed against the first', async () => {
    await writeFile(path.join(tempDir, 'range.txt'), 'a\nb\nc\nd\ne\n', 'utf8')
    const tool = createReadTool(undefined, tempDir, undefined, undefined, () => false)

    await tool.execute('r1', { path: 'range.txt', start_line: 2, end_line: 3 })
    const other = await tool.execute('r2', { path: 'range.txt', start_line: 4, end_line: 5 })
    expect(other.content).not.toContain(READ_DEDUP_STUB_PHRASE)
    expect(other.content).toContain('d')
  })

  test('a whole-file read never stubs against an earlier RANGED read of the same file', async () => {
    await writeFile(path.join(tempDir, 'range.txt'), 'a\nb\nc\n', 'utf8')
    const tool = createReadTool(undefined, tempDir, undefined, undefined, () => false)

    await tool.execute('r1', { path: 'range.txt', start_line: 1, end_line: 2 })
    const whole = await tool.execute('r2', { path: 'range.txt' })
    expect(whole.content).not.toContain(READ_DEDUP_STUB_PHRASE)
    expect(whole.content).toContain('c')
  })

  test('a CHANGED span re-delivers, even at the same window', async () => {
    const file = path.join(tempDir, 'range.txt')
    await writeFile(file, 'a\nb\nc\n', 'utf8')
    const tool = createReadTool(undefined, tempDir, undefined, undefined, () => false)

    await tool.execute('r1', { path: 'range.txt', start_line: 2, end_line: 2 })
    await writeFile(file, 'a\nCHANGED\nc\n', 'utf8')
    const again = await tool.execute('r2', { path: 'range.txt', start_line: 2, end_line: 2 })
    expect(again.content).toContain('CHANGED')
    expect(again.content).not.toContain(READ_DEDUP_STUB_PHRASE)
  })

  test('a line range applies to an extracted document, not just to plain text', async () => {
    // `attachment-spill`'s manifest tells the model to read a spilled .docx with
    // startLine/endLine. The document branch used to return before the range code,
    // handing back the WHOLE extraction while the model believed it got lines 2-3.
    const docPath = path.join(tempDir, 'report.docx')
    await writeFile(docPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])) // NUL byte ⇒ "binary"
    const extractor = async () => 'alpha\nbeta\ngamma\ndelta'
    const tool = createReadTool(undefined, tempDir, undefined, extractor)

    const whole = await tool.execute('d1', { path: 'report.docx' })
    expect(whole.content).toContain('alpha')
    expect(whole.content).toContain('delta')

    const slice = await tool.execute('d2', { path: 'report.docx', start_line: 2, end_line: 3 })
    expect(slice.content).toContain('beta')
    expect(slice.content).toContain('gamma')
    expect(slice.content).not.toContain('delta')
  })

  test('a TRUNCATED read arms no dedup stub — its tail was never delivered', async () => {
    // The stub says "unchanged since your earlier read (scroll up)". Scrolling up to a
    // truncated read shows only the head, so the tail would become unreachable: the
    // model has just been told it does not need to paginate.
    const big = `HEAD\n${'x'.repeat(70_000)}\nTAILMARKER\n`
    await writeFile(path.join(tempDir, 'big.txt'), big, 'utf8')
    const tool = createReadTool(undefined, tempDir, undefined, undefined, () => false)

    const first = await tool.execute('t1', { path: 'big.txt' })
    expect(first.content).toContain('truncated')
    expect(first.content).not.toContain('TAILMARKER')

    const second = await tool.execute('t2', { path: 'big.txt' })
    expect(second.content).not.toContain(READ_DEDUP_STUB_PHRASE)
    expect(second.content).toContain('truncated')
  })

  test('dedup spans RUNS: a second run sharing the session store still serves the stub', async () => {
    // The tool registry is rebuilt every run, but the history the stub points at is not.
    // Measured: 362 of 1970 full reads re-delivered a file the same session already had.
    await writeFile(path.join(tempDir, 'cross.txt'), 'hello world', 'utf8')
    const dedup = createReadDedupStore()
    const run1 = createReadTool(
      undefined,
      tempDir,
      undefined,
      undefined,
      () => false,
      createFileMtimeStore(),
      dedup,
    )
    const run2 = createReadTool(
      undefined,
      tempDir,
      undefined,
      undefined,
      () => false,
      createFileMtimeStore(),
      dedup,
    )

    expect((await run1.execute('r1', { path: 'cross.txt' })).content).toContain('hello world')
    expect((await run2.execute('r2', { path: 'cross.txt' })).content).toContain(
      READ_DEDUP_STUB_PHRASE,
    )
  })

  test('a cross-run STUB-served read still records the mtime — write is not refused as a blind overwrite', async () => {
    // ORDERING / causal-consistency: the dedup store outlives a run but the mtime
    // store is per-run. A cross-run read that only serves a stub must STILL record
    // the mtime in this run's store, or the write-guard would refuse a file the model
    // just re-read this run. Pins recordNow's placement BEFORE the dedup short-circuit
    // in read.ts (move it into the delivery-only path and this goes red).
    const file = path.join(tempDir, 'stub-mtime.txt')
    await writeFile(file, 'hello world', 'utf8')
    const dedup = createReadDedupStore()

    const run1Mtimes = createFileMtimeStore()
    const run1 = createReadTool(
      undefined,
      tempDir,
      undefined,
      undefined,
      () => false,
      run1Mtimes,
      dedup,
    )
    await run1.execute('r1', { path: 'stub-mtime.txt' })

    // Run 2: FRESH mtime store, SHARED dedup store — this read serves a stub.
    const run2Mtimes = createFileMtimeStore()
    const run2 = createReadTool(
      undefined,
      tempDir,
      undefined,
      undefined,
      () => false,
      run2Mtimes,
      dedup,
    )
    const r2 = await run2.execute('r2', { path: 'stub-mtime.txt' })

    expect(r2.content).toContain(READ_DEDUP_STUB_PHRASE) // confirm the stub path ran
    expect(run2Mtimes.has(file)).toBe(true) // ...and the write-guard precondition still holds
  })

  test("a different session does not inherit another session's dedup", async () => {
    await writeFile(path.join(tempDir, 'iso.txt'), 'hello world', 'utf8')
    const sessionA = createReadTool(
      undefined,
      tempDir,
      undefined,
      undefined,
      () => false,
      createFileMtimeStore(),
      createReadDedupStore(),
    )
    const sessionB = createReadTool(
      undefined,
      tempDir,
      undefined,
      undefined,
      () => false,
      createFileMtimeStore(),
      createReadDedupStore(),
    )

    expect((await sessionA.execute('a1', { path: 'iso.txt' })).content).toContain('hello world')
    expect((await sessionB.execute('b1', { path: 'iso.txt' })).content).toContain('hello world')
  })

  test('a file changed between runs re-delivers in full — no invalidation hook needed', async () => {
    await writeFile(path.join(tempDir, 'edited.txt'), 'before', 'utf8')
    const dedup = createReadDedupStore()
    const run1 = createReadTool(
      undefined,
      tempDir,
      undefined,
      undefined,
      () => false,
      createFileMtimeStore(),
      dedup,
    )
    const run2 = createReadTool(
      undefined,
      tempDir,
      undefined,
      undefined,
      () => false,
      createFileMtimeStore(),
      dedup,
    )

    await run1.execute('e1', { path: 'edited.txt' })
    await writeFile(path.join(tempDir, 'edited.txt'), 'after', 'utf8')
    expect((await run2.execute('e2', { path: 'edited.txt' })).content).toContain('after')
  })

  test('while the earlier read is intact the stub repeats — the model still has the content', async () => {
    // The one-shot rule existed only because compression can evict the earlier read.
    // While it survives, re-sending the whole file on every second re-read is pure
    // waste (94 of 131 reads in one measured session).
    await writeFile(path.join(tempDir, 'quiet.txt'), 'hello world', 'utf8')
    const tool = createReadTool(undefined, tempDir, undefined, undefined, () => false)

    const first = await tool.execute('q1', { path: 'quiet.txt' })
    expect(first.content).toContain('hello world')
    for (const id of ['q2', 'q3', 'q4']) {
      const r = await tool.execute(id, { path: 'quiet.txt' })
      expect(r.content).toContain(READ_DEDUP_STUB_PHRASE)
    }
  })

  test('when THAT earlier read is elided the full file comes back, and the stub re-arms on the new call', async () => {
    await writeFile(path.join(tempDir, 'gate.txt'), 'hello world', 'utf8')
    const elided = new Set<string>()
    const tool = createReadTool(undefined, tempDir, undefined, undefined, (id) => elided.has(id))

    await tool.execute('g1', { path: 'gate.txt' }) // full; stubs now point at g1
    expect((await tool.execute('g2', { path: 'gate.txt' })).content).toContain(
      READ_DEDUP_STUB_PHRASE,
    )

    // Compression elides g1: the stub's "scroll up" would be a lie.
    elided.add('g1')
    expect((await tool.execute('g3', { path: 'gate.txt' })).content).toContain('hello world')

    // g3 is now the intact anchor — stubs resume until IT is elided.
    expect((await tool.execute('g4', { path: 'gate.txt' })).content).toContain(
      READ_DEDUP_STUB_PHRASE,
    )
    elided.add('g3')
    expect((await tool.execute('g5', { path: 'gate.txt' })).content).toContain('hello world')
  })

  test('with no elision provider the tool degrades to the historical one-shot stub', async () => {
    // A host that cannot see what the wire dropped gets the pessimistic rule — never a
    // stub that might be a lie.
    await writeFile(path.join(tempDir, 'safe.txt'), 'hello world', 'utf8')
    const tool = createReadTool(undefined, tempDir)
    await tool.execute('s1', { path: 'safe.txt' })
    expect((await tool.execute('s2', { path: 'safe.txt' })).content).toContain(
      READ_DEDUP_STUB_PHRASE,
    )
    expect((await tool.execute('s3', { path: 'safe.txt' })).content).toContain('hello world')
  })

  test('dedup stub resets when the file changes', async () => {
    const p = path.join(tempDir, 'chg.txt')
    await writeFile(p, 'v1', 'utf8')
    const tool = createReadTool(undefined, tempDir)
    await tool.execute('c1', { path: 'chg.txt' })
    await tool.execute('c2', { path: 'chg.txt' }) // stub
    await writeFile(p, 'v2', 'utf8')
    const res = await tool.execute('c3', { path: 'chg.txt' })
    expect(res.content).toContain('v2')
  })
  /**
   * `read` publishes provenance for what it put in front of the model.
   *
   * Before this the answer's Sources list meant "web links from research": the tool that pulls the
   * MOST context into a coding session published nothing at all, so the list could never answer
   * "what did the agent actually look at".
   */
  test('a successful read publishes a CONSULTED file source at an openable URI', async () => {
    const filePath = path.join(tempDir, 'a.ts')
    await writeFile(filePath, 'export const a = 1\n', 'utf8')
    const tool = createReadTool(undefined, tempDir)

    const result = await tool.execute('tc-src', { path: filePath } as never)

    expect(result.sources).toHaveLength(1)
    expect(result.sources?.[0]).toMatchObject({
      kind: 'file',
      title: 'a.ts',
      role: 'consulted',
      status: 'available',
    })
    // The workbench already registers this URI (`FileTab.surface.ts`), which is what makes the
    // row clickable without one line of new navigation.
    expect(result.sources?.[0]?.uri).toBe(
      `localix://ui/work-item/file?path=${encodeURIComponent(filePath)}`,
    )
  })

  test('a FAILED read still publishes, marked failed', async () => {
    // "We tried to look at this and could not" is part of what informed the answer. The answer UI
    // hides `failed` records; the tool card keeps them. Publishing nothing would lose it entirely.
    const tool = createReadTool(undefined, tempDir)

    const result = await tool.execute('tc-miss', {
      path: path.join(tempDir, 'nope.ts'),
    } as never)

    expect(result.isError).toBe(true)
    expect(result.sources?.[0]).toMatchObject({ kind: 'file', status: 'failed' })
  })
})

/**
 * End-to-end filesystem behaviour: relative-cwd resolution, the directory listing,
 * the not-found error, and the byte cap. (Lived in a second read.test.ts at the
 * feature root, orphaned when the tool moved into tools/file/.)
 */
describe('createReadTool — filesystem basics', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
  })

  async function createTempDir() {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'read-tool-'))
    tempDirs.push(dir)
    return dir
  }

  test('reads a file via relative path and resolves cwd', async () => {
    const dir = await createTempDir()
    await writeFile(path.join(dir, 'note.txt'), 'hello from read tool')
    const tool = createReadTool()

    expect(tool.execute('call_1', { path: 'note.txt', cwd: dir })).resolves.toMatchObject({
      content: 'hello from read tool',
      details: {
        path: path.join(dir, 'note.txt'),
        bytes: 20,
        truncated: false,
        output: 'hello from read tool',
      },
    })
  })

  test('lists directory entries when the path is a directory', async () => {
    const dir = await createTempDir()
    await writeFile(path.join(dir, 'alpha.ts'), 'a')
    await writeFile(path.join(dir, 'beta.md'), 'b')
    const tool = createReadTool()

    const result = (await tool.execute('call_1', { path: dir })) as {
      content: string
      isError?: boolean
    }
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain(`Directory ${dir}`)
    expect(result.content).toContain('alpha.ts')
    expect(result.content).toContain('beta.md')
  })

  test('bounds directory listing at the producer and reports an inexact large count honestly', async () => {
    const entries = Array.from(
      { length: MAX_DIR_ENTRIES + 1 },
      (_, i) => `f${String(i).padStart(4, '0')}`,
    )
    let command = ''
    let options: Parameters<ExecutionEnvironment['exec']>[1]
    const env = {
      async exec(nextCommand: string, nextOptions?: Parameters<ExecutionEnvironment['exec']>[1]) {
        command = nextCommand
        options = nextOptions
        return { stdout: entries.join('\n'), stderr: '', exitCode: 0 }
      },
    } as ExecutionEnvironment

    const listing = await tryListDirectory(env, '/huge')

    expect(command).toContain(`| head -n ${MAX_DIR_ENTRIES + 1}`)
    expect(options).toMatchObject({ uncapped: true })
    expect(listing).toContain(
      `more than ${MAX_DIR_ENTRIES} entries (showing first ${MAX_DIR_ENTRIES})`,
    )
    expect(listing).toContain('f0000')
    expect(listing).toContain(`f${String(MAX_DIR_ENTRIES - 1).padStart(4, '0')}`)
    expect(listing).not.toContain(`f${String(MAX_DIR_ENTRIES).padStart(4, '0')}`)
    expect(listing).toContain('[…more entries omitted]')
  })

  test('returns a clean error for missing files', async () => {
    const dir = await createTempDir()
    const tool = createReadTool()

    expect(tool.execute('call_1', { path: 'missing.txt', cwd: dir })).resolves.toMatchObject({
      isError: true,
      content: `File not found: ${path.join(dir, 'missing.txt')}`,
      details: {
        path: path.join(dir, 'missing.txt'),
        bytes: 0,
        truncated: false,
        // Error text is mirrored into details.output so consumers that render `details` still show the reason.
        output: `File not found: ${path.join(dir, 'missing.txt')}`,
      },
    })
  })

  test('truncates large file output and preserves metadata', async () => {
    const dir = await createTempDir()
    const largeContent = 'a'.repeat(70_000)
    const filePath = path.join(dir, 'large.txt')
    await writeFile(filePath, largeContent)
    const tool = createReadTool()

    const result = await tool.execute('call_1', { path: filePath })

    expect(result.isError).toBeUndefined()
    expect(result.details).toMatchObject({
      path: filePath,
      bytes: 70_000,
      truncated: true,
    })
    expect(result.content).toContain('truncated at')
    expect(result.content).toContain('offset=')
    expect(result.content.length).toBeLessThan(70_000)
  })
})

/**
 * CHARACTERIZATION. The dedup stub is text the MODEL reads, and it is the only thing the
 * model is given in place of a file it asked for — if the sentence stops telling it how to
 * get the content back, the read is simply lost. It had no test at all; the phrase was
 * merely `toContain`-ed, which passes on any surrounding rewrite.
 *
 * `chat/runtime/run/wire-dump.ts` ALSO keys on {@link READ_DEDUP_STUB_PHRASE} to classify
 * a result as a recoverable dedup pointer, so the wording is a two-party contract.
 * Changing it is allowed; changing it by ACCIDENT is what this test prevents.
 */
describe('the dedup stub (model-facing bytes)', () => {
  test('exact wording — whole-file and windowed', () => {
    expect(readDedupStub('src/a.ts')).toBe(
      '[src/a.ts is unchanged since your earlier read this session \u2014 content omitted to save tokens (scroll up to that read). If it is no longer in your context, just read it again and the full content will be returned.]',
    )
    expect(readDedupStub('src/a.ts (L10-40)')).toStartWith('[src/a.ts (L10-40) is ')
  })

  test('it carries the phrase the wire-dump detector matches on', () => {
    // The detector's whole job is to recognise this stub. If the emitter stops containing
    // the phrase, an elided read silently stops being recognised as recoverable.
    expect(readDedupStub('x')).toContain(READ_DEDUP_STUB_PHRASE)
  })

  test('and it tells the model how to get the content back', () => {
    // The stub replaces the file. Without the recovery sentence the model is stuck.
    expect(readDedupStub('x')).toContain('read it again')
  })
})

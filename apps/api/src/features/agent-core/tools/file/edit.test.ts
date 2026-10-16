import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createEditTool, editToolInputSchema } from './edit'
import { createReadTool } from './read'
import { createFileMtimeStore } from './file-utils'

const signal = () => new AbortController().signal

describe('createEditTool', () => {
  let tempDir: string
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'localix-edit-'))
  })
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('replaces exactly one occurrence and reports the line', async () => {
    await writeFile(path.join(tempDir, 'a.ts'), 'const a = 1\nconst b = 2\nconst c = 3\n')
    const tool = createEditTool(undefined, tempDir)
    const result = await tool.execute(
      'e1',
      { edits: [{ path: 'a.ts', old_string: 'const b = 2', new_string: 'const b = 20' }] },
      signal(),
    )
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('1 replacement (line 2)')
    expect(await readFile(path.join(tempDir, 'a.ts'), 'utf8')).toBe(
      'const a = 1\nconst b = 20\nconst c = 3\n',
    )
    expect(result.details?.files[0]?.diff).toContain('-const b = 2')
  })

  test('asks about the editor buffer with the PRE-write disk text, and appends its note', async () => {
    // After the write a clean tab (still showing the old text) and a dirty one look the same,
    // so the probe must see the text the tool read, not the text it wrote.
    const file = path.join(tempDir, 'a.ts')
    await writeFile(file, 'const a = 1\n')
    const probed: { path: string; disk: string; moment: string }[] = []
    const tool = createEditTool(
      undefined,
      tempDir,
      undefined,
      undefined,
      undefined,
      (p, disk, moment) => {
        probed.push({ path: p, disk, moment })
        return '<editor_buffer>\nunsaved\n</editor_buffer>'
      },
    )
    const result = await tool.execute(
      'eb',
      { edits: [{ path: 'a.ts', old_string: 'const a = 1', new_string: 'const a = 2' }] },
      signal(),
    )
    expect(probed).toEqual([{ path: file, disk: 'const a = 1\n', moment: 'write' }])
    expect(result.content).toContain('<editor_buffer>\nunsaved\n</editor_buffer>')
  })

  test('an ambiguous old_string is refused with every line it occurs on', async () => {
    await writeFile(path.join(tempDir, 'a.ts'), 'x = 1\ny = 2\nx = 1\n')
    const tool = createEditTool(undefined, tempDir)
    const result = await tool.execute(
      'e2',
      { edits: [{ path: 'a.ts', old_string: 'x = 1', new_string: 'x = 9' }] },
      signal(),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('occurs 2 times')
    expect(result.content).toContain('lines 1, 3')
    // Nothing changed on disk.
    expect(await readFile(path.join(tempDir, 'a.ts'), 'utf8')).toBe('x = 1\ny = 2\nx = 1\n')
  })

  test('replace_all changes every occurrence', async () => {
    await writeFile(path.join(tempDir, 'a.ts'), 'x = 1\ny = 2\nx = 1\n')
    const tool = createEditTool(undefined, tempDir)
    const result = await tool.execute(
      'e3',
      { edits: [{ path: 'a.ts', old_string: 'x = 1', new_string: 'x = 9', replace_all: true }] },
      signal(),
    )
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('2 replacements')
    expect(await readFile(path.join(tempDir, 'a.ts'), 'utf8')).toBe('x = 9\ny = 2\nx = 9\n')
  })

  test('a CRLF file stays CRLF, and a LF old_string still matches it', async () => {
    await writeFile(path.join(tempDir, 'w.txt'), 'one\r\ntwo\r\nthree\r\n')
    const tool = createEditTool(undefined, tempDir)
    const result = await tool.execute(
      'e4',
      { edits: [{ path: 'w.txt', old_string: 'two\nthree', new_string: 'TWO\nTHREE' }] },
      signal(),
    )
    expect(result.isError).toBeFalsy()
    expect(await readFile(path.join(tempDir, 'w.txt'), 'utf8')).toBe('one\r\nTWO\r\nTHREE\r\n')
  })

  test('a whitespace-only mismatch is diagnosed as such, not as a missing span', async () => {
    await writeFile(path.join(tempDir, 'a.ts'), 'if (x) {\n    return 1\n}\n')
    const tool = createEditTool(undefined, tempDir)
    const result = await tool.execute(
      'e5',
      { edits: [{ path: 'a.ts', old_string: 'if (x) {\n  return 1\n}', new_string: 'return 1' }] },
      signal(),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('differs in indentation or spacing')
  })

  test('a miss on a file this session never read names the real cause', async () => {
    await writeFile(path.join(tempDir, 'a.ts'), 'real content\n')
    const tool = createEditTool(undefined, tempDir)
    const result = await tool.execute(
      'e6',
      { edits: [{ path: 'a.ts', old_string: 'imagined content', new_string: 'x' }] },
      signal(),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('have not read')
  })

  test('a file changed on disk after it was read is refused as stale', async () => {
    const file = path.join(tempDir, 'a.ts')
    await writeFile(file, 'v1\n')
    const mtimes = createFileMtimeStore()
    const read = createReadTool(undefined, tempDir, undefined, undefined, mtimes)
    await read.execute('r1', { path: 'a.ts' }, signal())
    // A later write by someone else, with a distinct mtime.
    await new Promise((resolve) => setTimeout(resolve, 20))
    await writeFile(file, 'v2\n')
    const tool = createEditTool(undefined, tempDir, undefined, undefined, mtimes)
    const result = await tool.execute(
      'e7',
      { edits: [{ path: 'a.ts', old_string: 'v1', new_string: 'v3' }] },
      signal(),
    )
    expect(result.isError).toBe(true)
    expect(await readFile(file, 'utf8')).toBe('v2\n')
  })

  test('refuses to invent a file — that is write’s job', async () => {
    const tool = createEditTool(undefined, tempDir)
    const result = await tool.execute(
      'e8',
      { edits: [{ path: 'missing.ts', old_string: 'a', new_string: 'b' }] },
      signal(),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Use `write`')
  })
})

describe('edit classification', () => {
  test.each([
    ['an edit', { edits: [{ path: 'a.txt', old_string: 'a', new_string: 'b' }] }],
    ['a historical single edit', { path: 'a.txt', old_string: 'a', new_string: 'b' }],
    ['unparseable input', 'not an object'],
  ])('%s reaches files', (_label, input) => {
    expect(createEditTool(undefined, '/tmp').classify?.(input)).toEqual({ effect: 'files' })
  })
})

describe('createEditTool — several edits in one call', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'localix-edit-batch-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('edits to one file apply in order, each against the text the previous one left', async () => {
    await writeFile(path.join(dir, 'a.ts'), 'let x = 1\nlet y = 2\n')
    const tool = createEditTool(undefined, dir)
    const result = await tool.execute(
      'm1',
      {
        edits: [
          { path: 'a.ts', old_string: 'let x = 1', new_string: 'let x = 10' },
          // Matches only AFTER the first edit ran.
          { path: 'a.ts', old_string: 'let x = 10\nlet y', new_string: 'let x = 10\nconst y' },
        ],
      },
      signal(),
    )
    expect(result.isError).toBeFalsy()
    expect(await readFile(path.join(dir, 'a.ts'), 'utf8')).toBe('let x = 10\nconst y = 2\n')
    expect(result.content).toContain('2 edits, 2 replacements')
    // One diff for the file, from the original to the final text.
    expect(result.details?.files).toHaveLength(1)
    expect(result.details?.files[0]?.diff).toContain('-let x = 1')
    expect(result.details?.files[0]?.diff).toContain('+const y = 2')
  })

  test('a failing edit fails its whole file, names its index, and writes nothing there', async () => {
    const file = path.join(dir, 'a.ts')
    await writeFile(file, 'one\ntwo\n')
    const tool = createEditTool(undefined, dir)
    const result = await tool.execute(
      'm2',
      {
        edits: [
          { path: 'a.ts', old_string: 'one', new_string: 'ONE' },
          { path: 'a.ts', old_string: 'three', new_string: 'THREE' },
        ],
      },
      signal(),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('edits[1]: `old_string` was not found')
    // The no-match diagnosis still names the real cause.
    expect(result.content).toContain('have not read')
    // The first edit matched, but the file is all-or-nothing.
    expect(await readFile(file, 'utf8')).toBe('one\ntwo\n')
  })

  test('an edit whose span an earlier edit consumed says so', async () => {
    await writeFile(path.join(dir, 'a.ts'), 'alpha beta\n')
    const tool = createEditTool(undefined, dir)
    const result = await tool.execute(
      'm3',
      {
        edits: [
          { path: 'a.ts', old_string: 'alpha beta', new_string: 'gamma' },
          { path: 'a.ts', old_string: 'beta', new_string: 'delta' },
        ],
      },
      signal(),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('An earlier edit in this call already changed that text')
  })

  test('across files, a failed file is reported and the others are still written', async () => {
    await writeFile(path.join(dir, 'a.ts'), 'a = 1\n')
    await writeFile(path.join(dir, 'b.ts'), 'b = 1\nb = 1\n')
    const tool = createEditTool(undefined, dir)
    const result = await tool.execute(
      'm4',
      {
        edits: [
          { path: 'a.ts', old_string: 'a = 1', new_string: 'a = 2' },
          { path: 'b.ts', old_string: 'b = 1', new_string: 'b = 2' },
        ],
      },
      signal(),
    )
    // Partly applied: a.ts is on disk, so the call is not an error.
    expect(result.isError).toBeFalsy()
    expect(await readFile(path.join(dir, 'a.ts'), 'utf8')).toBe('a = 2\n')
    expect(await readFile(path.join(dir, 'b.ts'), 'utf8')).toBe('b = 1\nb = 1\n')
    expect(result.content).toContain(`Edited ${path.join(dir, 'a.ts')}`)
    expect(result.content).toContain('Not changed — edits[1]: `old_string` occurs 2 times')
    expect(result.content).toContain('1 of 2 files failed')
    expect(result.details?.files.map((f) => [path.basename(f.path), f.failed ?? false])).toEqual([
      ['a.ts', false],
      ['b.ts', true],
    ])
    expect(result.details?.files[1]?.error).toContain('occurs 2 times')
  })

  test('diagnostics are asked once, for the files that changed', async () => {
    await writeFile(path.join(dir, 'a.ts'), 'a\n')
    await writeFile(path.join(dir, 'b.ts'), 'b\n')
    const asked: string[][] = []
    const tool = createEditTool(undefined, dir, async (paths) => {
      asked.push([...paths])
      return ''
    })
    await tool.execute(
      'm5',
      {
        edits: [
          { path: 'a.ts', old_string: 'a', new_string: 'A' },
          { path: 'b.ts', old_string: 'zzz', new_string: 'B' },
        ],
      },
      signal(),
    )
    expect(asked).toEqual([[path.join(dir, 'a.ts')]])
  })

  test('scopes the call by every file it names, deduplicated', () => {
    const tool = createEditTool(undefined, '/ws')
    const input = {
      edits: [
        { path: 'a.ts', old_string: 'x', new_string: 'y' },
        { path: 'b.ts', old_string: 'x', new_string: 'y' },
        { path: 'a.ts', old_string: 'y', new_string: 'z' },
      ],
    }
    expect(tool.parallelScopePaths?.(input)).toEqual(['/ws/a.ts', '/ws/b.ts'])
  })

  test('a Claude Code MultiEdit payload runs natively', async () => {
    await writeFile(path.join(dir, 'a.ts'), 'p\nq\n')
    const tool = createEditTool(undefined, dir)
    const multiEdit = {
      file_path: path.join(dir, 'a.ts'),
      edits: [
        { old_string: 'p', new_string: 'P' },
        { old_string: 'q', new_string: 'Q' },
      ],
    }
    // The schema lifts it (a hook's `updatedInput` is re-parsed through it) …
    const parsed = editToolInputSchema.safeParse(multiEdit)
    expect(parsed.success).toBe(true)
    // … and so does the dispatch path's `prepareArguments`.
    const result = await tool.execute('m6', tool.prepareArguments!(multiEdit) as never, signal())
    expect(result.isError).toBeFalsy()
    expect(await readFile(path.join(dir, 'a.ts'), 'utf8')).toBe('P\nQ\n')
  })
})

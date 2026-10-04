import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createEditTool } from './edit'
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
      { path: 'a.ts', old_string: 'const b = 2', new_string: 'const b = 20' },
      signal(),
    )
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('1 replacement (line 2)')
    expect(await readFile(path.join(tempDir, 'a.ts'), 'utf8')).toBe(
      'const a = 1\nconst b = 20\nconst c = 3\n',
    )
    expect((result.details as { diff?: string }).diff).toContain('-const b = 2')
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
      { path: 'a.ts', old_string: 'const a = 1', new_string: 'const a = 2' },
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
      { path: 'a.ts', old_string: 'x = 1', new_string: 'x = 9' },
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
      { path: 'a.ts', old_string: 'x = 1', new_string: 'x = 9', replace_all: true },
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
      { path: 'w.txt', old_string: 'two\nthree', new_string: 'TWO\nTHREE' },
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
      { path: 'a.ts', old_string: 'if (x) {\n  return 1\n}', new_string: 'return 1' },
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
      { path: 'a.ts', old_string: 'imagined content', new_string: 'x' },
      signal(),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('have not read')
  })

  test('a file changed on disk after it was read is refused as stale', async () => {
    const file = path.join(tempDir, 'a.ts')
    await writeFile(file, 'v1\n')
    const mtimes = createFileMtimeStore()
    const read = createReadTool(undefined, tempDir, undefined, undefined, undefined, mtimes)
    await read.execute('r1', { path: 'a.ts' }, signal())
    // A later write by someone else, with a distinct mtime.
    await new Promise((resolve) => setTimeout(resolve, 20))
    await writeFile(file, 'v2\n')
    const tool = createEditTool(undefined, tempDir, undefined, undefined, mtimes)
    const result = await tool.execute(
      'e7',
      { path: 'a.ts', old_string: 'v1', new_string: 'v3' },
      signal(),
    )
    expect(result.isError).toBe(true)
    expect(await readFile(file, 'utf8')).toBe('v2\n')
  })

  test('refuses to invent a file — that is write’s job', async () => {
    const tool = createEditTool(undefined, tempDir)
    const result = await tool.execute(
      'e8',
      { path: 'missing.ts', old_string: 'a', new_string: 'b' },
      signal(),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Use `write`')
  })
})

describe('edit classification', () => {
  test.each([
    ['an edit', { path: 'a.txt', old_string: 'a', new_string: 'b' }],
    ['unparseable input', 'not an object'],
  ])('%s reaches files', (_label, input) => {
    expect(createEditTool(undefined, '/tmp').classify?.(input)).toEqual({ effect: 'files' })
  })
})

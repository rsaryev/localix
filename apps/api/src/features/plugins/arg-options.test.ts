import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseArgOptions, runArgOptionsScript, ARG_OPTIONS_MAX_ITEMS } from './arg-options'

describe('parseArgOptions', () => {
  it('parses a JSON array of objects', () => {
    const out = parseArgOptions('[{"value":"a","label":"A","description":"d"},{"value":"b"}]')
    expect(out).toEqual([
      { value: 'a', label: 'A', description: 'd' },
      { value: 'b', label: 'b' },
    ])
  })

  it('treats bare strings as value+label', () => {
    expect(parseArgOptions('["x","y"]')).toEqual([
      { value: 'x', label: 'x' },
      { value: 'y', label: 'y' },
    ])
  })

  it('drops items without a value + blank lines', () => {
    expect(parseArgOptions('[{"label":"no value"},"",{"value":"ok"}]')).toEqual([
      { value: 'ok', label: 'ok' },
    ])
  })

  it('returns [] for non-JSON, non-array, or empty', () => {
    expect(parseArgOptions('')).toEqual([])
    expect(parseArgOptions('not json')).toEqual([])
    expect(parseArgOptions('{"value":"a"}')).toEqual([])
  })

  it('caps the number of options', () => {
    const many = JSON.stringify(
      Array.from({ length: ARG_OPTIONS_MAX_ITEMS + 50 }, (_, i) => `v${i}`),
    )
    expect(parseArgOptions(many)).toHaveLength(ARG_OPTIONS_MAX_ITEMS)
  })
})

describe('runArgOptionsScript', () => {
  let dir: string
  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'arg-options-'))
    // Echoes the query back as one option + a static one; proves stdin is read.
    await fs.writeFile(
      join(dir, 'echo.ts'),
      `const req = JSON.parse((await Bun.stdin.text()) || '{}');\n` +
        `console.log(JSON.stringify([{ value: req.query || 'none', label: 'q' }, 'static']));\n`,
    )
    await fs.writeFile(join(dir, 'hang.ts'), `await new Promise(() => {});\n`)
    await fs.writeFile(join(dir, 'bad.ts'), `console.log('not json at all');\n`)
  })
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('runs the script, feeds the request on stdin, returns stdout', async () => {
    const out = await runArgOptionsScript({
      scriptAbsPath: join(dir, 'echo.ts'),
      cwd: dir,
      request: { query: 'abc', cwd: dir, argName: 'x', command: 'c' },
    })
    expect(parseArgOptions(out)).toEqual([
      { value: 'abc', label: 'q' },
      { value: 'static', label: 'static' },
    ])
  })

  it('kills a hanging script at the timeout and returns empty', async () => {
    const out = await runArgOptionsScript({
      scriptAbsPath: join(dir, 'hang.ts'),
      cwd: dir,
      request: { query: '', cwd: dir, argName: 'x', command: 'c' },
      timeoutMs: 300,
    })
    expect(out).toBe('')
  })

  it('a non-existent script yields empty (never throws)', async () => {
    const out = await runArgOptionsScript({
      scriptAbsPath: join(dir, 'nope.ts'),
      cwd: dir,
      request: { query: '', cwd: dir, argName: 'x', command: 'c' },
    })
    expect(parseArgOptions(out)).toEqual([])
  })

  it('bad (non-JSON) stdout parses to []', async () => {
    const out = await runArgOptionsScript({
      scriptAbsPath: join(dir, 'bad.ts'),
      cwd: dir,
      request: { query: '', cwd: dir, argName: 'x', command: 'c' },
    })
    expect(parseArgOptions(out)).toEqual([])
  })
})

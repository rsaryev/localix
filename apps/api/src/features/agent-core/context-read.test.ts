import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readCappedFile, type CappedReadSpec } from './context-read'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'ctxread-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const MARKER = '\n[cut]'
/** Small cap so the byte window (maxChars * 4 = 40B) is easy to straddle in a test. */
const SPEC: CappedReadSpec = { maxChars: 10, truncationMarker: MARKER }

async function write(name: string, content: string): Promise<string> {
  const p = join(root, name)
  await fs.writeFile(p, content, 'utf8')
  return p
}

/**
 * The semantics the bounded read must reproduce EXACTLY: read the whole file, trim,
 * cap, mark. `readCappedFile` only reads a prefix — every case below asserts it lands
 * on the same answer this naive version would, so the bound stays an optimization and
 * never a behavior.
 */
function naive(raw: string, { maxChars, truncationMarker }: CappedReadSpec): string | null {
  const content = raw.trim()
  if (!content) return null
  return content.length > maxChars ? content.slice(0, maxChars) + truncationMarker : content
}

describe('readCappedFile', () => {
  test('returns null when there is nothing to contribute', async () => {
    expect(await readCappedFile(join(root, 'missing.md'), SPEC)).toBeNull()
    expect(await readCappedFile(root, SPEC)).toBeNull() // a directory, not a file
    expect(await readCappedFile(await write('empty.md', ''), SPEC)).toBeNull()
    expect(await readCappedFile(await write('blank.md', '  \n\t\n  '), SPEC)).toBeNull()
  })

  test('returns a short file whole, trimmed', async () => {
    const p = await write('short.md', '\n  hello  \n')
    expect(await readCappedFile(p, SPEC)).toBe('hello')
  })

  test('caps at maxChars and appends the caller-supplied marker', async () => {
    const raw = 'abcdefghijKLMNOP'
    const p = await write('long.md', raw)
    expect(await readCappedFile(p, SPEC)).toBe(`abcdefghij${MARKER}`)
    expect(await readCappedFile(p, SPEC)).toBe(naive(raw, SPEC))
  })

  test('a file far past the byte window still yields exactly the first maxChars', async () => {
    // 1 MB — well beyond maxChars * 4, so the bounded path is taken.
    const raw = 'x'.repeat(1_000_000)
    const p = await write('huge.md', raw)
    expect(await readCappedFile(p, SPEC)).toBe(`${'x'.repeat(10)}${MARKER}`)
    expect(await readCappedFile(p, SPEC)).toBe(naive(raw, SPEC))
  })

  test('multi-byte UTF-8 torn by the byte window does not corrupt the kept chars', async () => {
    // '中' is 3 bytes, so the 40-byte window ends mid-sequence (40 / 3 = 13.3) — the
    // read genuinely tears a code point. The tear lands past maxChars, so the 10 chars
    // we keep are untouched and the damaged char is sliced away.
    const raw = '中'.repeat(500)
    const p = await write('cjk.md', raw)
    const got = await readCappedFile(p, SPEC)
    expect(got).toBe(naive(raw, SPEC))
    expect(got).toBe(`${'中'.repeat(10)}${MARKER}`)
    expect(got).not.toContain('�') // no replacement char survives into the result
  })

  test('a character cap never leaves half of a UTF-16 surrogate pair', async () => {
    const p = await write('emoji.md', 'a😀b')
    const got = await readCappedFile(p, { maxChars: 2, truncationMarker: MARKER })

    expect(got).toBe(`a${MARKER}`)
    expect(got).not.toMatch(/[\uD800-\uDFFF](?![\uDC00-\uDFFF])/)
  })

  test('content that starts BEYOND the byte window is still found', async () => {
    // The pathological input where "read a prefix" and "read the file" disagree: the
    // whole byte window is whitespace, so a bounded read alone trims to empty and would
    // drop a file that is not empty at all.
    const raw = `${' '.repeat(5_000)}real content here`
    const p = await write('late.md', raw)
    expect(await readCappedFile(p, SPEC)).toBe(naive(raw, SPEC))
    expect(await readCappedFile(p, SPEC)).toBe(`real conte${MARKER}`)
  })

  test('a long whitespace prefix and trailing whitespace preserve whole-read semantics', async () => {
    const raw = `${' '.repeat(200_000)}abc${' '.repeat(200_000)}`
    const p = await write('padded.md', raw)
    expect(await readCappedFile(p, SPEC)).toBe(naive(raw, SPEC))
    expect(await readCappedFile(p, SPEC)).toBe('abc')
  })

  test('internal whitespace past the cap is retained when later content proves truncation', async () => {
    const raw = `a${' '.repeat(100)}b`
    const p = await write('internal-space.md', raw)
    expect(await readCappedFile(p, SPEC)).toBe(naive(raw, SPEC))
  })

  test("the cap and marker are the caller's, not the module's", async () => {
    const p = await write('shared.md', 'abcdefghijklmnop')
    expect(await readCappedFile(p, { maxChars: 3, truncationMarker: '<A>' })).toBe('abc<A>')
    expect(await readCappedFile(p, { maxChars: 5, truncationMarker: '<B>' })).toBe('abcde<B>')
  })
})

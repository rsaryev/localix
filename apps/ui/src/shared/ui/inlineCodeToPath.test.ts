import { describe, expect, it } from 'bun:test'
import { inlineCodeToPath, inlineCodeLine, fileHrefToReference } from './markdownFileRef'

const pathOf = (href?: string) => fileHrefToReference(href)?.path ?? null
const lineOf = (href?: string) => fileHrefToReference(href)?.line

describe('inlineCodeToPath', () => {
  it('links paths with a directory', () => {
    expect(inlineCodeToPath('src/features/foo.ts')).toBe('src/features/foo.ts')
    expect(inlineCodeToPath('./a/b.tsx')).toBe('./a/b.tsx')
    expect(inlineCodeToPath('/Users/me/app/index.ts')).toBe('/Users/me/app/index.ts')
  })

  it('strips a trailing :line[:col]', () => {
    expect(inlineCodeToPath('src/a.ts:42')).toBe('src/a.ts')
    expect(inlineCodeToPath('src/a.ts:42:7')).toBe('src/a.ts')
  })

  it('links bare filenames with known code extensions', () => {
    expect(inlineCodeToPath('package.json')).toBe('package.json')
    expect(inlineCodeToPath('README.md')).toBe('README.md')
  })

  it('does NOT link member access or prose-like tokens', () => {
    expect(inlineCodeToPath('array.map')).toBeNull()
    expect(inlineCodeToPath('item.input')).toBeNull()
    expect(inlineCodeToPath('foo.bar')).toBeNull()
    expect(inlineCodeToPath('useState')).toBeNull()
    expect(inlineCodeToPath('npm run build')).toBeNull() // has spaces
    expect(inlineCodeToPath('src/components')).toBeNull() // dir, no extension
  })
})

describe('inlineCodeLine', () => {
  it('extracts the line (not the column) from a path:line[:col] token', () => {
    expect(inlineCodeLine('src/a.ts:42')).toBe(42)
    expect(inlineCodeLine('src/a.ts:42:7')).toBe(42)
  })
  it('returns undefined when there is no line suffix', () => {
    expect(inlineCodeLine('src/a.ts')).toBeUndefined()
    expect(inlineCodeLine('package.json')).toBeUndefined()
  })
})

describe('a file href → its path', () => {
  it('returns a workspace file path, stripping a #L line anchor', () => {
    expect(pathOf('src/a.ts')).toBe('src/a.ts')
    expect(pathOf('src/a.ts#L42')).toBe('src/a.ts')
    expect(pathOf('src/a.ts#L42-L50')).toBe('src/a.ts')
    expect(pathOf('docs/guide.md')).toBe('docs/guide.md')
  })

  it('ignores web/mail/anchor schemes and non-file hrefs', () => {
    expect(pathOf('https://example.com/a.ts')).toBeNull()
    expect(pathOf('mailto:x@y.com')).toBeNull()
    expect(pathOf('#section')).toBeNull()
    expect(pathOf('just-a-word')).toBeNull() // no slash, no extension
    expect(pathOf(undefined)).toBeNull()
  })
})

describe('a file href → its line', () => {
  it('extracts the line from a #L42 / #42 anchor', () => {
    expect(lineOf('src/a.ts#L42')).toBe(42)
    expect(lineOf('src/a.ts#7')).toBe(7)
    expect(lineOf('src/a.ts#L42-L50')).toBe(42)
  })
  it('returns undefined without an anchor', () => {
    expect(lineOf('src/a.ts')).toBeUndefined()
    expect(lineOf(undefined)).toBeUndefined()
  })
})

import { describe, expect, it } from 'bun:test'
import { inlineCodeToPath, inlineCodeLine, fileHrefToPath, fileHrefLine } from './markdownFileRef'

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

describe('fileHrefToPath', () => {
  it('returns a workspace file path, stripping a #L line anchor', () => {
    expect(fileHrefToPath('src/a.ts')).toBe('src/a.ts')
    expect(fileHrefToPath('src/a.ts#L42')).toBe('src/a.ts')
    expect(fileHrefToPath('src/a.ts#L42-L50')).toBe('src/a.ts')
    expect(fileHrefToPath('docs/guide.md')).toBe('docs/guide.md')
  })

  it('ignores web/mail/anchor schemes and non-file hrefs', () => {
    expect(fileHrefToPath('https://example.com/a.ts')).toBeNull()
    expect(fileHrefToPath('mailto:x@y.com')).toBeNull()
    expect(fileHrefToPath('#section')).toBeNull()
    expect(fileHrefToPath('just-a-word')).toBeNull() // no slash, no extension
    expect(fileHrefToPath(undefined)).toBeNull()
  })
})

describe('fileHrefLine', () => {
  it('extracts the line from a #L42 / #42 anchor', () => {
    expect(fileHrefLine('src/a.ts#L42')).toBe(42)
    expect(fileHrefLine('src/a.ts#7')).toBe(7)
    expect(fileHrefLine('src/a.ts#L42-L50')).toBe(42)
  })
  it('returns undefined without an anchor', () => {
    expect(fileHrefLine('src/a.ts')).toBeUndefined()
    expect(fileHrefLine(undefined)).toBeUndefined()
  })
})

import { describe, expect, test } from 'bun:test'

import {
  inlineCodeToPath,
  inlineCodeLine,
  fileHrefToPath,
  fileHrefLine,
  fileHrefToReference,
  sandboxHrefToPath,
} from './markdownFileRef'

describe('inlineCodeToPath', () => {
  test('a directory path with an extension is a file token', () => {
    expect(inlineCodeToPath('src/foo.ts')).toBe('src/foo.ts')
    expect(inlineCodeToPath('./a/b.tsx')).toBe('./a/b.tsx')
  })

  test('strips a trailing :line[:col]', () => {
    expect(inlineCodeToPath('src/foo.ts:42')).toBe('src/foo.ts')
    expect(inlineCodeToPath('src/foo.ts:42:5')).toBe('src/foo.ts')
  })

  test('a bare filename links only for known source/config extensions', () => {
    expect(inlineCodeToPath('package.json')).toBe('package.json')
    expect(inlineCodeToPath('README.md')).toBe('README.md')
    // member access / prose must NOT linkify
    expect(inlineCodeToPath('array.map')).toBeNull()
    expect(inlineCodeToPath('item.input')).toBeNull()
  })

  test('rejects tokens with whitespace or empty input', () => {
    expect(inlineCodeToPath('hello world')).toBeNull()
    expect(inlineCodeToPath('   ')).toBeNull()
    expect(inlineCodeToPath('')).toBeNull()
  })

  test('a bare word with no extension is not a path', () => {
    expect(inlineCodeToPath('foo')).toBeNull()
  })
})

describe('inlineCodeLine', () => {
  test('reads the line (not the column) from path:line[:col]', () => {
    expect(inlineCodeLine('src/foo.ts:42')).toBe(42)
    expect(inlineCodeLine('src/foo.ts:42:5')).toBe(42)
  })

  test('undefined when there is no line suffix', () => {
    expect(inlineCodeLine('src/foo.ts')).toBeUndefined()
  })
})

describe('fileHrefToPath', () => {
  test('a workspace-relative href is a file path', () => {
    expect(fileHrefToPath('src/foo.ts')).toBe('src/foo.ts')
    expect(fileHrefToPath('README.md')).toBe('README.md')
  })

  test('strips a #L42 / #42 line anchor', () => {
    expect(fileHrefToPath('src/foo.ts#L42')).toBe('src/foo.ts')
    expect(fileHrefToPath('src/foo.ts#42')).toBe('src/foo.ts')
  })

  test('resolves a hostless sandbox artifact href to its absolute file path', () => {
    const plan = '\u041f\u043b\u0430\u043d'
    expect(
      fileHrefToPath('sandbox:/Users/me/.localix/workspace/LOCALIX-7/%D0%9F%D0%BB%D0%B0%D0%BD.pdf'),
    ).toBe(`/Users/me/.localix/workspace/LOCALIX-7/${plan}.pdf`)
    expect(sandboxHrefToPath('sandbox:/C:/Users/me/report.pdf')).toBe('C:/Users/me/report.pdf')
  })

  test('resolves canonical Localix and standard hostless file URIs', () => {
    expect(
      fileHrefToReference('localix://ui/work-item/file?path=%2FUsers%2Fme%2FMy+Report.pdf&line=12'),
    ).toEqual({ path: '/Users/me/My Report.pdf', line: 12 })
    expect(fileHrefToPath('file:///Users/me/My%20Report.pdf')).toBe('/Users/me/My Report.pdf')
    expect(fileHrefToPath('file:///C:/Users/me/report.pdf')).toBe('C:/Users/me/report.pdf')
  })

  test('rejects malformed sandbox links instead of treating them as app paths', () => {
    expect(fileHrefToPath('sandbox://remote.example/report.pdf')).toBeNull()
    expect(fileHrefToPath('sandbox:relative/report.pdf')).toBeNull()
    expect(fileHrefToPath('sandbox:/tmp/report.pdf?download=1')).toBeNull()
    expect(fileHrefToPath('file://remote.example/report.pdf')).toBeNull()
    expect(fileHrefToPath('localix://resource/fixture-doc/abc')).toBeNull()
    expect(fileHrefToPath('localix://ui/work-item/file?path=%2Fa.ts&extra=1')).toBeNull()
  })

  test('rejects web/mail/anchor schemes and undefined', () => {
    expect(fileHrefToPath('https://x.com/a.ts')).toBeNull()
    expect(fileHrefToPath('mailto:x@y.com')).toBeNull()
    expect(fileHrefToPath('#section')).toBeNull()
    expect(fileHrefToPath(undefined)).toBeNull()
  })

  test('a bare word with no extension or slash is not a file href', () => {
    expect(fileHrefToPath('foo')).toBeNull()
  })
})

describe('fileHrefLine', () => {
  test('reads the line from a #L42 / #42 anchor', () => {
    expect(fileHrefLine('src/foo.ts#L42')).toBe(42)
    expect(fileHrefLine('src/foo.ts#42')).toBe(42)
  })

  test('undefined when there is no anchor', () => {
    expect(fileHrefLine('src/foo.ts')).toBeUndefined()
    expect(fileHrefLine(undefined)).toBeUndefined()
  })
})

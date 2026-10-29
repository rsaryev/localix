import { describe, expect, test } from 'bun:test'

import { opensFile } from './opens'

describe('which files a package that opens these kinds takes', () => {
  test('a file of a kind it names, whatever the case of its name', () => {
    expect(opensFile(['docx', 'pdf'], '/work/Report.DOCX')).toBe(true)
    expect(opensFile(['docx', 'pdf'], 'C:\\work\\scan.pdf')).toBe(true)
  })

  test('a kind of two parts only on a name that ends in both', () => {
    expect(opensFile(['request.json'], '/api/login.request.json')).toBe(true)
    expect(opensFile(['request.json'], '/api/package.json')).toBe(false)
  })

  test('a kind that is a whole name, such as Dockerfile', () => {
    expect(opensFile(['dockerfile'], '/app/Dockerfile')).toBe(true)
    expect(opensFile(['dockerfile'], '/app/web.dockerfile')).toBe(true)
    expect(opensFile(['dockerfile'], '/app/Dockerfile.md')).toBe(false)
  })

  test('nothing else', () => {
    expect(opensFile(['docx'], '/work/notes.doc')).toBe(false)
    expect(opensFile(['docx'], '/work/docx')).toBe(true)
    expect(opensFile([], '/work/a.docx')).toBe(false)
  })
})

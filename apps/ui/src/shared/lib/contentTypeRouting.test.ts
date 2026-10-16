import { beforeAll, describe, expect, test } from 'bun:test'
import {
  CSV_CONTENT_TYPE,
  DOCX_CONTENT_TYPE,
  ODT_CONTENT_TYPE,
  PDF_CONTENT_TYPE,
  PPTX_CONTENT_TYPE,
  XLSX_CONTENT_TYPE,
  contentTypeForPath,
  fileExtension,
  fileViewerKind,
  isOpenExternallyType,
  registerDedicatedViewerTypes,
} from './contentTypeRouting'

// The registry starts empty in core. These tests exercise the generic routing helpers
// over a representative populated registry.
beforeAll(() => {
  registerDedicatedViewerTypes({
    pdf: { contentType: PDF_CONTENT_TYPE, viewer: 'pdf', openExternally: true },
    docx: { contentType: DOCX_CONTENT_TYPE, viewer: 'document', openExternally: true },
    odt: { contentType: ODT_CONTENT_TYPE, viewer: 'document', openExternally: true },
    pptx: { contentType: PPTX_CONTENT_TYPE, viewer: 'document', openExternally: true },
    xlsx: { contentType: XLSX_CONTENT_TYPE, viewer: 'spreadsheet', openExternally: true },
    csv: { contentType: CSV_CONTENT_TYPE, viewer: 'spreadsheet' },
  })
})

describe('fileExtension', () => {
  test('lowercases and strips the dot', () => {
    expect(fileExtension('/a/B.PDF')).toBe('pdf')
    expect(fileExtension('report.final.docx')).toBe('docx')
    expect(fileExtension('C:\\docs\\sheet.XLSX')).toBe('xlsx')
  })
  test('no extension → empty', () => {
    expect(fileExtension('Makefile')).toBe('')
    expect(fileExtension('.gitignore')).toBe('') // leading dot = dotfile, not an ext
    expect(fileExtension('/path/to/dir/')).toBe('')
  })
})

describe('contentTypeForPath', () => {
  test('maps known document extensions', () => {
    expect(contentTypeForPath('a.pdf')).toBe(PDF_CONTENT_TYPE)
    expect(contentTypeForPath('a.docx')).toBe(DOCX_CONTENT_TYPE)
    expect(contentTypeForPath('a.xlsx')).toBe(XLSX_CONTENT_TYPE)
    expect(contentTypeForPath('a.csv')).toBe(CSV_CONTENT_TYPE)
  })
  test('unknown / code / text extensions → undefined (editor path)', () => {
    expect(contentTypeForPath('a.ts')).toBeUndefined()
    expect(contentTypeForPath('README.md')).toBeUndefined()
    expect(contentTypeForPath('index.html')).toBeUndefined()
    expect(contentTypeForPath('.doc')).toBeUndefined() // legacy binary formats unsupported
  })
})

describe('fileViewerKind', () => {
  test('routes each recognized format to its viewer', () => {
    expect(fileViewerKind('a.pdf')).toBe('pdf')
    expect(fileViewerKind('a.docx')).toBe('document')
    expect(fileViewerKind('a.odt')).toBe('document')
    expect(fileViewerKind('slides.pptx')).toBe('document')
    expect(fileViewerKind('data.xlsx')).toBe('spreadsheet')
    expect(fileViewerKind('data.csv')).toBe('spreadsheet')
  })
  test('everything else stays in the editor', () => {
    expect(fileViewerKind('main.ts')).toBe('editor')
    expect(fileViewerKind('notes.md')).toBe('editor')
    expect(fileViewerKind('page.html')).toBe('editor')
    expect(fileViewerKind('noext')).toBe('editor')
  })
})

describe('classification sets', () => {
  test('binary office/pdf types are open-externally, csv is not', () => {
    expect(isOpenExternallyType(PDF_CONTENT_TYPE)).toBe(true)
    expect(isOpenExternallyType(DOCX_CONTENT_TYPE)).toBe(true)
    expect(isOpenExternallyType(XLSX_CONTENT_TYPE)).toBe(true)
    expect(isOpenExternallyType(CSV_CONTENT_TYPE)).toBe(false) // text, not a binary doc
    expect(isOpenExternallyType(undefined)).toBe(false)
  })
})

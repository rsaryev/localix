import { expect, test } from 'bun:test'
import { documentSchema, emptyDocument, emptyEntry } from './schema'
import { applyOperations } from './operations'

function fixture() {
  const document = emptyDocument()
  document.sections.push({
    id: crypto.randomUUID(),
    type: 'summary',
    title: 'Summary',
    hidden: false,
    entries: [emptyEntry()],
  })
  return document
}
test('section types reject fields that their editor cannot represent', () => {
  const document = fixture()
  document.sections[0]!.entries[0]!.organization = 'Invisible company'
  const result = documentSchema.safeParse(document)
  expect(result.success).toBe(false)
  if (!result.success)
    expect(result.error.issues[0]?.path).toEqual(['sections', 0, 'entries', 0, 'organization'])
  document.sections[0]!.entries[0]!.organization = ''
  document.sections[0]!.entries.push(emptyEntry())
  expect(documentSchema.safeParse(document).success).toBe(false)
})
test('date failures, duplicate identities and executable links fail validation', () => {
  const document = fixture()
  const section = document.sections[0]!
  section.type = 'experience'
  section.entries[0]!.start = '2025-12'
  section.entries[0]!.end = '2024-01'
  expect(documentSchema.safeParse(document).success).toBe(false)
  section.entries[0]!.end = '2026-01'
  section.entries[0]!.current = true
  expect(documentSchema.safeParse(document).success).toBe(false)
  section.entries[0]!.current = false
  section.entries[0]!.link = { label: 'Unsafe', url: 'javascript:alert(1)' }
  expect(documentSchema.safeParse(document).success).toBe(false)
  section.entries[0]!.link = null
  section.entries[0]!.id = section.id
  expect(documentSchema.safeParse(document).success).toBe(false)
})
test('an invalid operation batch has no partial effect and cannot re-key an entry', () => {
  const document = fixture()
  const original = structuredClone(document)
  expect(() =>
    applyOperations(document, [
      { op: 'metadata', value: { title: 'Changed' } },
      { op: 'removeSection', sectionId: crypto.randomUUID() },
    ]),
  ).toThrow('Section not found')
  expect(document).toEqual(original)
  expect(() =>
    applyOperations(document, [
      {
        op: 'updateEntry',
        sectionId: document.sections[0]!.id,
        entryId: document.sections[0]!.entries[0]!.id,
        value: { id: crypto.randomUUID() },
      } as never,
    ]),
  ).toThrow()
})

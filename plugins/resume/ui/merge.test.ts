import { expect, test } from 'bun:test'
import { mergeDocuments } from './merge'
import { createTemplateDocument } from '../shared/templates'
import { emptyEntry } from '../shared/schema'

test('independent saved edits merge into an unfinished local draft without losing invalid-but-recoverable input', () => {
  const base = createTemplateDocument('awal', 'CV')
  const draft = structuredClone(base)
  draft.header.links = [{ label: 'Portfolio', url: '' }]
  const remote = structuredClone(base)
  remote.targetRole = 'Engineer'
  const result = mergeDocuments(base, draft, remote)
  expect(result.conflicts).toEqual([])
  expect(result.document?.header.links).toEqual(draft.header.links)
  expect(result.document?.targetRole).toBe('Engineer')
})
test('entry deletion versus editing is a conflict while independent entry additions both survive', () => {
  const base = createTemplateDocument('awal', 'CV')
  const section = base.sections.find((item) => item.type === 'experience')!
  section.entries = [{ ...emptyEntry(), title: 'Existing role' }]
  const draft = structuredClone(base)
  const remote = structuredClone(base)
  draft.sections[1]!.entries = []
  remote.sections[1]!.entries[0]!.title = 'Agent updated role'
  expect(mergeDocuments(base, draft, remote).document).toBeNull()
  expect(mergeDocuments(base, draft, remote).conflicts[0]).toContain(section.entries[0]!.id)
  draft.sections[1]!.entries = [...section.entries, { ...emptyEntry(), title: 'Local addition' }]
  remote.sections[1]!.entries = [...section.entries, { ...emptyEntry(), title: 'Agent addition' }]
  const merged = mergeDocuments(base, draft, remote)
  expect(merged.conflicts).toEqual([])
  expect(merged.document?.sections[1]!.entries.map((item) => item.title).sort()).toEqual([
    'Agent addition',
    'Existing role',
    'Local addition',
  ])
})

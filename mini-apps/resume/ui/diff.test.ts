import { expect, test } from 'bun:test'
import { documentOperations } from './diff'
import { applyOperations } from '../shared/operations'
import { createTemplateDocument } from '../shared/templates'
import { emptyEntry } from '../shared/schema'

test('mixed add/remove/reorder edits reproduce the draft while addressing retained entries by identity', () => {
  const before = createTemplateDocument('awal', 'CV')
  const experience = before.sections.find((section) => section.type === 'experience')!
  experience.entries = [emptyEntry(), emptyEntry(), emptyEntry()]
  const after = structuredClone(before)
  after.header.name = 'Candidate'
  after.targetRole = 'Engineer'
  after.presentation.template = 'ketik'
  after.sections = [after.sections[2]!, after.sections[1]!, after.sections[0]!]
  const updated = after.sections[1]!
  updated.entries = [updated.entries[2]!, emptyEntry(), updated.entries[0]!]
  updated.entries[2]!.title = 'Updated role'
  const ops = documentOperations(before, after)
  expect(applyOperations(before, ops)).toEqual(after)
  expect(ops.filter((op) => op.op === 'updateEntry')).toEqual([
    {
      op: 'updateEntry',
      sectionId: experience.id,
      entryId: experience.entries[0]!.id,
      value: { title: 'Updated role' },
    },
  ])
  expect(before.header.name).toBe('')
})

import { expect, test } from 'bun:test'
import { richTextToText } from '@localixai/mini-app-sdk/rich-text'
import { emptyEntry, documentSchema } from './schema'
import { createSampleDocument } from './sample'
import { resumeLayout } from './layout'
import { documentOperations } from '../ui/diff'
import { applyOperations } from './operations'
import { exportDocument } from './format'
import { parseResumeFile, exportInterchange } from './interchange'
import { importSourceText } from './source-import'
import { byRecency } from './order'

test('presentation, grid and photo removal survive revision-safe operation deltas', () => {
  const before = createSampleDocument('awal', 'CV')
  const after = structuredClone(before)
  after.presentation = {
    template: 'tebal',
    font: 'inter',
    lineHeight: 1.7,
    bodyScale: 1.1,
    photoAlign: 'bottom',
  }
  after.header.photo = null
  const skills = after.sections.find((section) => section.type === 'skills')!
  skills.columns = 1
  skills.showProficiency = false
  expect(applyOperations(before, documentOperations(before, after))).toEqual(
    documentSchema.parse(after),
  )
  expect(resumeLayout(after).blocks.find((block) => block.kind === 'columns')?.columns.length).toBe(
    1,
  )
})

test('hidden proficiency is omitted from every visible export without modifying the core', () => {
  const doc = createSampleDocument('klasik', 'CV')
  const skills = doc.sections.find((section) => section.type === 'skills')!
  skills.entries = [
    { ...emptyEntry(), title: 'TypeScript', proficiency: 'Expert', body: 'Legacy skill level' },
  ]
  skills.showProficiency = false
  expect(exportDocument(doc, 'text')).not.toContain('Expert')
  expect(exportDocument(doc, 'markdown')).toContain('Legacy skill level')
  expect(JSON.stringify(resumeLayout(doc))).not.toContain('Expert')
  expect(exportDocument(doc, 'json')).toContain('Expert')
})

test('native YAML preserves every canonical field and rejects aliases', () => {
  const doc = createSampleDocument('ketat', 'CV')
  doc.targetRole = 'Private tailoring context'
  doc.presentation = { template: 'ketat', font: 'lora', letterSpacing: 0.2 }
  expect(parseResumeFile(exportDocument(doc, 'yaml'), 'resume.yaml')).toEqual(
    documentSchema.parse(doc),
  )
  expect(() => parseResumeFile('a: &a [one]\nb: *a', 'resume.yaml')).toThrow()
})

test('Lanjut interchange imports formatting, context, numeric years and presentation', () => {
  const input = {
    format: 'lanjut-resume',
    version: 1,
    title: 'CV',
    template: 'tebal',
    font: 'inter',
    bodyScale: 1.1,
    header: {
      firstName: '\u0410\u043b\u0435\u043a\u0441\u0435\u0439',
      lastName: '\u0418\u0432\u0430\u043d\u043e\u0432',
      city: '\u041c\u043e\u0441\u043a\u0432\u0430',
    },
    sections: [
      {
        type: 'experience',
        entries: [
          {
            title: 'Engineer',
            company: 'Demo',
            companyContext: 'B2B software',
            startDate: 2022,
            endDate: 'Present',
            description: '**Evidence**\n- *Result*',
          },
        ],
      },
      {
        type: 'skills',
        columns: 1,
        showProficiency: false,
        entries: [{ name: 'Node.js', level: 'Advanced' }],
      },
    ],
  }
  const doc = parseResumeFile(JSON.stringify(input), 'resume.json')
  expect(doc.header.name).toBe(
    '\u0410\u043b\u0435\u043a\u0441\u0435\u0439 \u0418\u0432\u0430\u043d\u043e\u0432',
  )
  expect(doc.presentation.bodyScale).toBe(1.1)
  expect(doc.sections[0]!.entries[0]!.context).toBe('B2B software')
  expect(doc.sections[0]!.entries[0]!.current).toBe(true)
  expect(richTextToText(doc.sections[0]!.entries[0]!.body)).toContain('Evidence')
  const roundtrip = parseResumeFile(exportInterchange(doc), 'resume.json')
  expect(roundtrip.header.name).toBe(doc.header.name)
  expect(roundtrip.sections[1]!.showProficiency).toBe(false)
})

test('source import recognizes dated entries and retains unassigned text for review', () => {
  const source =
    'Jane Sample\nSome unassigned text\nExperience\nSenior Engineer\n2022-03 – Present\nDemo Company\n- Shipped a service\nJunior Engineer\n2020 – 2022\nExample Studio\n- Built an API'
  const { document, leftovers } = importSourceText(source, 'Imported')
  expect(document.header.name).toBe('Jane Sample')
  expect(leftovers).toContain('Some unassigned text')
  expect(document.sections[0]!.entries).toHaveLength(2)
  expect(document.sections[0]!.entries[0]!.start).toBe('2022-03')
  expect(document.sections[0]!.entries[0]!.current).toBe(true)
  expect(richTextToText(document.sections[0]!.entries[1]!.body)).toContain('Built an API')
  expect(documentSchema.safeParse(document).success).toBe(true)
})

test('ongoing dates sort first, and rich custom sections cannot hide list fields', () => {
  const items = [
    { ...emptyEntry(), start: '2019', end: '2020' },
    { ...emptyEntry(), start: '2022', current: true },
    { ...emptyEntry(), start: '2020', end: '2022' },
  ]
  expect([...items].sort(byRecency).map((entry) => entry.start)).toEqual(['2022', '2020', '2019'])
  const doc = createSampleDocument('awal', 'CV')
  doc.sections.push({
    id: crypto.randomUUID(),
    type: 'custom',
    title: 'Notes',
    hidden: false,
    variant: 'rich',
    entries: [{ ...emptyEntry(), title: 'Invisible field' }],
  })
  expect(documentSchema.safeParse(doc).success).toBe(false)
})

test('hiding proficiency keeps skill evidence in preview and office exports', () => {
  const doc = createSampleDocument('awal', 'CV')
  const skills = doc.sections.find((section) => section.type === 'skills')!
  skills.showProficiency = false
  skills.entries[0]!.proficiency = 'Advanced'
  skills.entries[0]!.body = 'AWS, Terraform, Kubernetes'
  const layout = resumeLayout(doc)
  const content = JSON.stringify(layout.blocks)
  expect(content).toContain('AWS, Terraform, Kubernetes')
  expect(content).not.toContain('Advanced')
})

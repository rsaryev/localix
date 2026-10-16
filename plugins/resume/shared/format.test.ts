import { expect, test } from 'bun:test'
import { documentBlocks } from './document-blocks'
import { exportDocument } from './format'
import { createTemplateDocument, templateIds } from './templates'
import { emptyEntry } from './schema'

function resume() {
  const document = createTemplateDocument('awal', 'CV')
  document.header.name = 'Candidate'
  document.targetRole = 'PRIVATE ROLE'
  document.jobDescription = 'PRIVATE JOB DESCRIPTION'
  document.header.links = [{ label: 'Portfolio', url: 'https://example.com/a%20b(foo)_v2' }]
  document.sections[0]!.entries[0]!.body = 'Professional summary'
  document.sections[1]!.entries = [
    {
      ...emptyEntry(),
      title: 'Engineer',
      body: 'C++ and user_id and *literal*',
      bullets: ['Delivered outcome'],
    },
  ]
  const hidden = document.sections.find((item) => item.type === 'projects')!
  hidden.hidden = true
  hidden.entries = [{ ...emptyEntry(), title: 'HIDDEN PROJECT' }]
  return document
}
test('all template projections share visible content and reading order, excluding empty and hidden sections', () => {
  const document = resume()
  const expected = exportDocument(document, 'text')
  for (const template of templateIds) {
    document.presentation.template = template
    expect(exportDocument(document, 'text')).toBe(expected)
  }
  expect(
    documentBlocks(document)
      .filter((block) => block.kind === 'heading')
      .map((block) => block.title),
  ).toEqual(['Summary', 'Experience'])
  expect(expected.indexOf('Professional summary')).toBeLessThan(expected.indexOf('Engineer'))
  expect(expected).not.toContain('PRIVATE')
  expect(expected).not.toContain('HIDDEN PROJECT')
  expect(expected).not.toContain('Education')
  expect(JSON.parse(exportDocument(document, 'json'))).toEqual(document)
})
test('Markdown keeps authored punctuation literal and preserves URL percent encoding', () => {
  const markdown = exportDocument(resume(), 'markdown')
  expect(markdown).toContain('C\\+\\+ and user\\_id and \\*literal\\*')
  expect(markdown).toContain('https://example.com/a%20b(foo)_v2')
  expect(markdown).not.toContain('%2520')
})

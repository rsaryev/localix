import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import { emptyDocument, emptyEntry } from '../shared/schema'
import { documentErrors, ValidationScope } from './validation'
import { SectionEditor } from './SectionEditor'
import { HeaderEditor } from './HeaderEditor'

let teardown: () => Promise<void>
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const prior = environment.IS_REACT_ACT_ENVIRONMENT
beforeAll(() => {
  teardown = registerDom()
  environment.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
  if (prior === undefined) delete environment.IS_REACT_ACT_ENVIRONMENT
  else environment.IS_REACT_ACT_ENVIRONMENT = prior
})

test('date and unfinished link errors are associated with their controls and clear after correction', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const documentValue = emptyDocument('CV')
  documentValue.header.links = [{ label: 'Portfolio', url: '' }]
  const section = {
    id: crypto.randomUUID(),
    type: 'experience' as const,
    title: 'Experience',
    hidden: false,
    entries: [{ ...emptyEntry(), title: 'Engineer', start: '2025-06', end: '2024-01' }],
  }
  documentValue.sections = [section]
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const render = () => (
    <ValidationScope errors={documentErrors(documentValue)}>
      <HeaderEditor document={documentValue} onChange={() => {}} />
      <ValidationScope prefix="sections.0">
        <SectionEditor section={section} onChange={() => {}} />
      </ValidationScope>
    </ValidationScope>
  )
  try {
    await act(async () => root.render(render()))
    const invalid = [...host.querySelectorAll('input[aria-invalid="true"]')]
    expect(invalid).toHaveLength(2)
    for (const input of invalid) {
      const description = input.getAttribute('aria-describedby')!
      expect(description).toBeTruthy()
      expect(host.querySelector(`[id="${description}"]`)?.getAttribute('role')).toBe('alert')
    }
    expect(host.textContent).toContain('End date precedes start date')
    section.entries[0]!.end = '2026-01'
    documentValue.header.links[0]!.url = 'https://example.com'
    await act(async () => root.render(render()))
    expect(host.querySelectorAll('input[aria-invalid="true"]')).toHaveLength(0)
    expect(host.textContent).not.toContain('End date precedes start date')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

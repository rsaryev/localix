import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import { bindMiniAppUiTransport } from '@localixai/mini-app-sdk/ui/transport'
import type { PublishedMessageContext } from '@localixai/mini-app-sdk/ui'
import { createTemplateDocument } from '../shared/templates'
import type { Resume } from '../shared/schema'
import { HistoryPanel } from './HistoryPanel'

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

test('selects a historical snapshot, confirms restoration, stays visible after a new head, and clears context on close', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const documentValue = createTemplateDocument('awal', 'CV')
  documentValue.header.name = 'Current candidate'
  const oldDocument = structuredClone(documentValue)
  oldDocument.header.name = 'Earlier candidate'
  const resume: Resume = {
    id: crypto.randomUUID(),
    revision: 'a'.repeat(64),
    createdAt: '2026-10-07T09:00:00.000Z',
    updatedAt: '2026-10-07T10:00:00.000Z',
    document: documentValue,
  }
  const oldRevision = 'b'.repeat(64)
  const records = [
    {
      revision: resume.revision,
      document: documentValue,
      recordedAt: resume.updatedAt,
      actor: 'user',
      label: 'Current edit',
    },
    {
      revision: oldRevision,
      document: oldDocument,
      recordedAt: resume.createdAt,
      actor: 'agent',
      label: 'Initial version',
    },
  ]
  const unbind = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path) => {
      const pathname = new URL(path, 'http://localhost').pathname
      if (pathname.endsWith('/history'))
        return Response.json(records.map(({ document: _document, ...record }) => record))
      return Response.json(records.find((record) => pathname.endsWith(record.revision)))
    },
  })
  const publications: Array<PublishedMessageContext | null> = []
  const publish = (context: PublishedMessageContext | null) => {
    publications.push(context)
  }
  const restored: string[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const render = () => (
    <HistoryPanel
      sessionId="session"
      resume={resume}
      dirty={false}
      pending={false}
      onRestore={(target) => restored.push(target)}
      onClose={() => {}}
      publishMessageContext={publish}
    />
  )
  const button = (label: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (item) => item.textContent === label,
    )!
  try {
    await act(async () => root.render(render()))
    expect(host.textContent).toContain('Current candidate')
    await act(async () =>
      button('Saved history').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      ),
    )
    const oldChoice = [
      ...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
    ].find((item) => item.textContent?.includes('Initial version'))
    expect(oldChoice).toBeDefined()
    await act(async () => oldChoice!.click())
    expect(host.textContent).toContain('Earlier candidate')
    expect(host.textContent).not.toContain('Current candidate')
    expect(JSON.stringify(publications.at(-1))).toContain(oldRevision)
    await act(async () => button('Restore this version…').click())
    expect(restored).toEqual([])
    await act(async () => button('Restore version').click())
    expect(restored).toEqual([oldRevision])
    resume.revision = 'c'.repeat(64)
    records.unshift({ ...records[0]!, revision: resume.revision, document: oldDocument })
    await act(async () => root.render(render()))
    expect(host.textContent).toContain('Earlier candidate')
    expect(host.textContent).not.toContain('Loading saved revision')
  } finally {
    await act(async () => root.unmount())
    unbind()
    host.remove()
  }
  expect(publications.at(-1)).toBeNull()
})

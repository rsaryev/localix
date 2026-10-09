import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import type { PublishedMessageContext } from '@localixai/plugin-sdk/ui'
import { createTemplateDocument } from '../shared/templates'
import type { MotionProject } from '../shared/schema'

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
test('editor publishes scene identity, preserves a draft on agent updates and clears inactive context', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ProjectEditor } = await import('./ProjectEditor')
  const project: MotionProject = {
    id: crypto.randomUUID(),
    revision: 1,
    updatedAt: new Date().toISOString(),
    document: createTemplateDocument('launch'),
  }
  const publications: Array<PublishedMessageContext | null> = []
  const publish = (context: PublishedMessageContext | null) => {
    publications.push(context)
  }
  const dirty: boolean[] = []
  const onDirty = (value: boolean) => {
    dirty.push(value)
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const render = (project: MotionProject, active = true) => (
    <ProjectEditor
      project={project}
      assets={[]}
      active={active}
      sending={false}
      onSave={async () => null}
      onUpload={async () => null}
      onDirtyChange={onDirty}
      publishMessageContext={publish}
    />
  )
  const button = (text: string) =>
    [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === text)!
  try {
    await act(async () => {
      root.render(render(project))
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(JSON.stringify(publications.at(-1))).toContain(project.id)
    expect(JSON.stringify(publications.at(-1))).toContain(project.document.scenes[0]!.id)
    await act(async () => button('Add scene').click())
    expect(dirty.at(-1)).toBe(true)
    expect(JSON.stringify(publications.at(-1))).toContain('UNSAVED')
    expect(
      host.querySelector('[aria-label="Video scenes"]')?.querySelectorAll('button'),
    ).toHaveLength(5)
    const changed: MotionProject = {
      ...project,
      revision: 2,
      document: { ...project.document, title: 'Agent change' },
    }
    await act(async () => root.render(render(changed)))
    expect(host.textContent).toContain('The agent changed this video.')
    expect(
      host.querySelector('[aria-label="Video scenes"]')?.querySelectorAll('button'),
    ).toHaveLength(5)
    expect(button('Save').disabled).toBe(true)
    const binding = publications.at(-1)!.bindings[0]!.target
    expect(JSON.parse(String(binding.attributes?.content)).baseRevision).toBe(1)
    await act(async () => button('Discard draft').click())
    expect((host.querySelector('[aria-label="Video title"]') as HTMLInputElement).value).toBe(
      'Agent change',
    )
    expect(
      host.querySelector('[aria-label="Video scenes"]')?.querySelectorAll('button'),
    ).toHaveLength(4)
    await act(async () => root.render(render(changed, false)))
    expect(publications.at(-1)).toBeNull()
    await act(async () => root.render(render(changed)))
    expect(JSON.stringify(publications.at(-1))).not.toContain('UNSAVED')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
  expect(publications.at(-1)).toBeNull()
})

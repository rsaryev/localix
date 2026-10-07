import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import type { ResumeSummary } from '../shared/schema'

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

test('compact resume rows keep navigation and secondary actions independent, including pending state', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ResumeRow } = await import('./ResumeRow')
  const resume: ResumeSummary = {
    id: crypto.randomUUID(),
    title: 'Backend resume',
    targetRole: 'Node.js engineer',
    revision: 'a'.repeat(64),
    updatedAt: '2026-10-07T10:00:00.000Z',
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  let opened = 0
  let renamed = 0
  const render = (disabled: boolean) => (
    <ResumeRow
      resume={resume}
      disabled={disabled}
      onOpen={() => opened++}
      entries={[{ id: 'rename', label: 'Rename', onSelect: () => renamed++ }]}
    />
  )
  try {
    await act(async () => root.render(render(false)))
    const open = host.querySelector('button[aria-label="Open Backend resume"]') as HTMLButtonElement
    const actions = host.querySelector(
      'button[aria-label="Actions for Backend resume"]',
    ) as HTMLButtonElement
    expect(open.contains(actions)).toBe(false)
    expect(host.textContent).toContain('Node.js engineer')
    expect(host.querySelector('time')?.dateTime).toBe(resume.updatedAt)
    await act(async () => open.click())
    expect(opened).toBe(1)
    await act(async () =>
      actions.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })),
    )
    expect(opened).toBe(1)
    const rename = document.querySelector('[role="menuitem"]') as HTMLElement
    expect(rename.textContent).toContain('Rename')
    await act(async () => rename.click())
    expect(renamed).toBe(1)
    expect(opened).toBe(1)
    await act(async () => root.render(render(true)))
    expect(open.disabled).toBe(true)
    expect(
      host.querySelector<HTMLButtonElement>('button[aria-label="Actions for Backend resume"]')!
        .disabled,
    ).toBe(true)
    await act(async () => open.click())
    expect(opened).toBe(1)
  } finally {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    await act(async () => root.unmount())
    host.remove()
  }
})

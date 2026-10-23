import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import type { RepoCommit } from '../../../backend/source-control/contracts'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

const commit: RepoCommit = {
  hash: 'a1b2c3d4e5',
  shortHash: 'a1b2c3d',
  subject: 'feat: first draft',
  author: 'Ada',
  relativeDate: 'now',
}

/** Set a controlled field's value through the native setter so React's onChange runs. */
function typeInto(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    field instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field, value)
  field.dispatchEvent(new window.Event('input', { bubbles: true }))
}

const button = (label: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  )

async function mount(node: React.ReactNode) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(node))
  return {
    act,
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('BranchAtDialog', () => {
  test('confirm waits for a name, submits it trimmed, and Cancel closes', async () => {
    const { BranchAtDialog } = await import('./CommitGraphDialogs')
    const submitted: Array<[string, string]> = []
    let closed = 0
    const view = await mount(
      <BranchAtDialog
        target={commit}
        onClose={() => closed++}
        onSubmit={(name, target) => submitted.push([name, target.hash])}
      />,
    )
    try {
      expect(button('Create branch')?.disabled).toBe(true)
      const input = document.body.querySelector<HTMLInputElement>('[aria-label="Branch name"]')!
      await view.act(async () => typeInto(input, '  feature/x  '))
      expect(button('Create branch')?.disabled).toBe(false)
      await view.act(async () => button('Create branch')?.click())
      expect(submitted).toEqual([['feature/x', commit.hash]])
      await view.act(async () => button('Cancel')?.click())
      expect(closed).toBe(1)
    } finally {
      await view.unmount()
    }
  })
})

describe('RewordDialog', () => {
  test('starts from the subject, refuses an empty message, and Cancel closes', async () => {
    const { RewordDialog } = await import('./CommitGraphDialogs')
    const submitted: Array<[string, string]> = []
    let closed = 0
    const view = await mount(
      <RewordDialog
        target={commit}
        onClose={() => closed++}
        onSubmit={(message, target) => submitted.push([message, target.hash])}
      />,
    )
    try {
      const textarea = document.body.querySelector<HTMLTextAreaElement>('textarea')!
      expect(textarea.value).toBe(commit.subject)
      expect(button('Reword')?.disabled).toBe(false)
      await view.act(async () => typeInto(textarea, '   '))
      expect(button('Reword')?.disabled).toBe(true)
      await view.act(async () => typeInto(textarea, 'fix: better words '))
      await view.act(async () => button('Reword')?.click())
      expect(submitted).toEqual([['fix: better words', commit.hash]])
      await view.act(async () => button('Cancel')?.click())
      expect(closed).toBe(1)
    } finally {
      await view.unmount()
    }
  })
})

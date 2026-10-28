import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { MessageBinding } from '@/shared/api/contracts'
import type { useContextRefs } from '../../model/useContextRefs'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

test('context-only submit sends empty prose and structured refs, never synthetic UUID tokens', async () => {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { usePromptSend } = await import('./usePromptSend')
  const { makeSnippetRef } = await import('@localixai/api/context-refs')
  const pinned = makeSnippetRef({ label: 'Preview', content: 'Fix spacing' })
  const bindings: MessageBinding[] = [
    {
      kind: 'context',
      id: 'context',
      source: 'mention',
      target: {
        kind: 'snippet',
        token: '@snippet:uuid',
        label: 'Preview',
        attributes: { content: 'Fix spacing' },
      },
      resolution: { status: 'pending', contributions: [] },
    },
  ]
  const sends: Array<[string | undefined, MessageBinding[] | undefined]> = []
  const cleared: string[][] = []
  const ctxRefs = {
    pinnedRefs: [pinned],
    refsForSend: async () => bindings,
    clearPinnedRefs: (keys: string[]) => cleared.push(keys),
  } as unknown as ReturnType<typeof useContextRefs>
  function Harness() {
    const { handleSend } = usePromptSend({
      prompt: '',
      ctxRefs,
      onSend: (text, refs) => sends.push([text, refs]),
      isEditing: false,
      openCommandActive: false,
      submitOpenResource: () => {},
    })
    return <button onClick={handleSend}>Submit fixture</button>
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => {
      root.render(<Harness />)
    })
    await act(async () => {
      host.querySelector('button')!.click()
    })
    expect(sends).toEqual([['', bindings]])
    expect(cleared).toEqual([[pinned.key]])
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

// Enter on an empty composer sent the active tab's automatic context as a
// message of its own (empty text), which was queued behind the run and then started one.
test('Enter on an empty composer sends nothing, whatever ambient context is attached', async () => {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { usePromptSend } = await import('./usePromptSend')
  const ambient: MessageBinding[] = [
    {
      kind: 'context',
      id: 'tab',
      source: 'active-tab',
      target: {
        kind: 'snippet',
        token: '@snippet:tab',
        label: 'Tab',
        attributes: { content: 'x' },
      },
      resolution: { status: 'pending', contributions: [] },
    },
  ]
  const sends: unknown[] = []
  const ctxRefs = {
    pinnedRefs: [],
    refsForSend: async () => ambient,
    clearPinnedRefs: () => {},
  } as unknown as ReturnType<typeof useContextRefs>
  function Harness() {
    const { handleSend } = usePromptSend({
      prompt: '  ',
      ctxRefs,
      onSend: (text) => sends.push(text),
      isEditing: false,
      openCommandActive: false,
      submitOpenResource: () => {},
    })
    return <button onClick={handleSend}>Submit fixture</button>
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => {
      root.render(<Harness />)
    })
    await act(async () => {
      host.querySelector('button')!.click()
    })
    expect(sends).toEqual([])
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})

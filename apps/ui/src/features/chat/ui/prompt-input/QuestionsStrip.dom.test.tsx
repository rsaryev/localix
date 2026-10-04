import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { SessionQuestion, UiSession } from '@/shared/api/contracts'
import { useChatStore } from '@/features/chat/model/store'
import { useQuestionUiStore } from '../../model/questionUi'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

const question: SessionQuestion = {
  id: 'q-2',
  agentId: 'lead',
  toolCallId: 'call-ask',
  askedAt: new Date().toISOString(),
  questions: [
    {
      id: 'db',
      question: 'Which database?',
      options: [{ label: 'Postgres' }, { label: 'SQLite' }],
    },
  ],
}

const buttonNamed = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
    button.textContent?.trim().startsWith(text),
  )

async function render(questions: SessionQuestion[]) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { QuestionsPanel } = await import('./QuestionsPanel')
  const { ChatInteractionOverlay } = await import('../hitl/ChatInteractionOverlay')
  const { ActionRegistryProvider } = await import('@/shared/lib/actions/ActionRegistryProvider')
  useQuestionUiStore.setState({ openBySession: {}, submittingBySession: {} })
  useChatStore.setState({
    allSessions: [{ id: 's1', agents: [], questions } as unknown as UiSession],
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  function Fixture() {
    const openId = useQuestionUiStore((state) => state.openBySession.s1)
    const open = useChatStore((state) =>
      state.allSessions
        .find((session) => session.id === 's1')
        ?.questions?.find((q) => q.id === openId),
    )
    return (
      <>
        <div data-testid="strip">
          <QuestionsPanel sessionId="s1" />
        </div>
        <div data-testid="composer">
          {open ? (
            <ChatInteractionOverlay
              interaction={null}
              queuedQuestion={{ sessionId: 's1', question: open }}
              submittingRequestId={null}
              keyboardActive
              onAnswer={() => {}}
              onSubmitSecret={() => {}}
              onDismiss={() => {}}
            />
          ) : (
            <textarea aria-label="Message draft" defaultValue="Continue with the report" />
          )}
        </div>
      </>
    )
  }
  await React.act(async () =>
    root.render(
      <ActionRegistryProvider>
        <Fixture />
      </ActionRegistryProvider>,
    ),
  )
  return {
    host,
    act: React.act,
    unmount: () =>
      React.act(async () => {
        root.unmount()
        host.remove()
      }),
  }
}

describe('the questions strip', () => {
  test('answering opens the shared composer form outside the strip, and sends by id', async () => {
    const { backendClient } = await import('@/shared/api/client')
    const original = backendClient.answerQuestion.bind(backendClient)
    const answer = mock(async () => {})
    backendClient.answerQuestion = answer
    const { host, act, unmount } = await render([question])
    try {
      // Collapsed, it says what is being asked — not a bare count.
      expect(host.textContent).toContain('Which database?')
      await act(async () => buttonNamed(host, 'Answer')?.click())

      // The answering form, and none of a blocking card's words: nothing auto-denies here.
      const form = host.querySelector('[data-slot="hitl-frame"]')
      expect(form).not.toBeNull()
      expect(host.querySelector('[data-testid="strip"] [data-slot="hitl-frame"]')).toBeNull()
      expect(host.querySelector('[data-testid="composer"] [data-slot="hitl-frame"]')).toBe(form)
      expect(host.querySelector('textarea')).toBeNull()
      expect(host.textContent).not.toContain('Auto-deny')
      expect(buttonNamed(host, 'Deny')).toBeUndefined()

      const postgres = [
        ...host.querySelectorAll<HTMLButtonElement>(
          '[aria-label="Answers for Which database?"] button',
        ),
      ].find((button) => button.textContent?.includes('Postgres'))
      await act(async () => postgres?.click())
      await act(async () => buttonNamed(host, 'Send answer')?.click())

      expect(answer).toHaveBeenCalledWith('s1', 'q-2', [
        { id: 'db', question: 'Which database?', selectedOptions: ['Postgres'] },
      ])
      // Sent: the card closes; the server's push is what removes the row.
      expect(host.querySelector('[data-slot="hitl-frame"]')).toBeNull()
    } finally {
      backendClient.answerQuestion = original
      await unmount()
    }
  })

  test('Answer later restores the composer and leaves the question available to reopen', async () => {
    const { backendClient } = await import('@/shared/api/client')
    const original = backendClient.skipQuestion.bind(backendClient)
    const skip = mock(async () => {})
    backendClient.skipQuestion = skip
    const { host, act, unmount } = await render([question])
    try {
      await act(async () => buttonNamed(host, 'Answer')?.click())
      await act(async () => buttonNamed(host, 'Answer later')?.click())
      expect(host.querySelector('[data-slot="hitl-frame"]')).toBeNull()
      expect(skip).not.toHaveBeenCalled()
      expect(useChatStore.getState().allSessions[0]?.questions).toEqual([question])
      expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe(
        'Continue with the report',
      )

      await act(async () => buttonNamed(host, 'Answer')?.click())
      expect(host.querySelector('[data-slot="hitl-frame"]')).not.toBeNull()
      await act(async () =>
        host.querySelector<HTMLButtonElement>('button[aria-label="Answer later"]')?.click(),
      )
      expect(host.querySelector('[data-slot="hitl-frame"]')).toBeNull()

      await act(async () => buttonNamed(host, 'Answer')?.click())
      await act(async () => {
        host.querySelector<HTMLInputElement>('input')?.focus()
        window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(host.querySelector('[data-slot="hitl-frame"]')).toBeNull()
      expect(skip).not.toHaveBeenCalled()

      await act(async () =>
        host.querySelector<HTMLButtonElement>('button[aria-label="Skip q-2"]')?.click(),
      )
      expect(skip).toHaveBeenCalledWith('s1', 'q-2')
    } finally {
      backendClient.skipQuestion = original
      await unmount()
    }
  })

  test('a question another tab answered closes quietly', async () => {
    const { backendClient, ApiError } = await import('@/shared/api/client')
    const original = backendClient.answerQuestion.bind(backendClient)
    backendClient.answerQuestion = mock(async () => {
      throw Object.assign(Object.create(ApiError.prototype), { status: 409 })
    })
    const { host, act, unmount } = await render([question])
    try {
      await act(async () => buttonNamed(host, 'Answer')?.click())
      const sqlite = [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        b.textContent?.includes('SQLite'),
      )
      await act(async () => sqlite?.click())
      await act(async () => buttonNamed(host, 'Send answer')?.click())
      expect(host.querySelector('[data-slot="hitl-frame"]')).toBeNull()
    } finally {
      backendClient.answerQuestion = original
      await unmount()
    }
  })

  test('a server push closes a question that was resolved elsewhere', async () => {
    const { host, act, unmount } = await render([question])
    try {
      await act(async () => buttonNamed(host, 'Answer')?.click())
      expect(host.querySelector('[data-slot="hitl-frame"]')).not.toBeNull()
      await act(async () =>
        useChatStore.setState({
          allSessions: [{ id: 's1', agents: [], questions: [] } as unknown as UiSession],
        }),
      )
      expect(host.querySelector('[data-slot="hitl-frame"]')).toBeNull()
      expect(host.querySelector('textarea')).not.toBeNull()
    } finally {
      await unmount()
    }
  })

  test('Answer is suggested once the run is idle, never while it works or a plan waits', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { QuestionsStrip } = await import('./QuestionsStrip')
    useQuestionUiStore.setState({ openBySession: {}, submittingBySession: {} })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const suggested = async (isGenerating: boolean, plans: unknown[] = []) => {
      await React.act(async () => {
        useChatStore.setState({
          allSessions: [
            { id: 's1', agents: [], rootSessionId: null, questions: [question], plans },
          ] as unknown as UiSession[],
        })
        root.render(<QuestionsStrip sessionId="s1" isGenerating={isGenerating} />)
        // The panel is lazy: let its chunk resolve.
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      const answer = buttonNamed(host, 'Answer')
      expect(answer).toBeDefined()
      return answer?.getAttribute('data-recommended') === 'true'
    }
    try {
      expect(await suggested(false)).toBe(true)
      expect(await suggested(true)).toBe(false)
      expect(await suggested(false, [{ id: 'p1', status: 'presented', version: 1 }])).toBe(false)
    } finally {
      await React.act(async () => root.unmount())
      host.remove()
    }
  })

  test('a delayed answer never closes a different question selected in the meantime', async () => {
    const { backendClient } = await import('@/shared/api/client')
    const original = backendClient.answerQuestion.bind(backendClient)
    let release: () => void = () => {}
    backendClient.answerQuestion = mock(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const second = { ...question, id: 'q-3', toolCallId: 'call-second' }
    const { host, act, unmount } = await render([question, second])
    try {
      await act(async () => buttonNamed(host, 'Answer')?.click())
      await act(async () =>
        [...host.querySelectorAll<HTMLButtonElement>('button')]
          .find((b) => b.textContent?.includes('Postgres'))
          ?.click(),
      )
      await act(async () => buttonNamed(host, 'Send answer')?.click())
      await act(async () =>
        host.querySelector<HTMLButtonElement>('button[aria-label^="Answer q-3:"]')?.click(),
      )
      expect(useQuestionUiStore.getState().openBySession.s1).toBe('q-3')
      await act(async () => release())
      expect(useQuestionUiStore.getState().openBySession.s1).toBe('q-3')
      expect(host.querySelector('[data-slot="hitl-frame"]')?.textContent).toContain('q-3')
      expect(host.querySelector('[aria-pressed="true"]')).toBeNull()
    } finally {
      release()
      backendClient.answerQuestion = original
      await unmount()
    }
  })
})

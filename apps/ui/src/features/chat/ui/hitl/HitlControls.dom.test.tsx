import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type {
  PendingAskInteraction,
  PendingRequestSecretInteraction,
} from '../../model/agent-runtime'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

const setInputValue = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  const InputEvent = input.ownerDocument.defaultView?.Event ?? Event
  input.dispatchEvent(new InputEvent('input', { bubbles: true }))
}

describe('HITL control contracts', () => {
  test('Answer later and closing a queueable ask defer it without denying or answering', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { AskInteractionView } = await import('./AskInteractionView')
    const { ActionRegistryProvider } = await import('@/shared/lib/actions/ActionRegistryProvider')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const deferred: string[] = []
    const denied: string[] = []
    const answered: unknown[] = []
    const interaction: PendingAskInteraction = {
      kind: 'ask',
      request: {
        id: 'ask-later',
        kind: 'ask',
        payload: {
          toolCallId: 'ask-later',
          loading_messages: [],
          canDefer: true,
          questions: [
            { id: 'direction', question: 'Which direction?', options: [{ label: 'Fast' }] },
          ],
        },
      },
    }
    try {
      await React.act(async () =>
        root.render(
          <ActionRegistryProvider>
            <AskInteractionView
              interaction={interaction}
              submitting={false}
              onSubmit={(_id, answers) => {
                answered.push(answers)
              }}
              onDismiss={(id) => {
                denied.push(id)
              }}
              onDefer={(id) => {
                deferred.push(id)
              }}
            />
          </ActionRegistryProvider>,
        ),
      )
      const later = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
        button.textContent?.trim().startsWith('Answer later'),
      )
      await React.act(async () => later?.click())
      await React.act(async () =>
        host.querySelector<HTMLButtonElement>('[aria-label="Answer later"]')?.click(),
      )
      await React.act(async () => {
        host.querySelector<HTMLInputElement>('input')?.focus()
        host
          .querySelector('input')
          ?.dispatchEvent(
            new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
          )
      })
      expect(deferred).toEqual(['ask-later', 'ask-later', 'ask-later'])
      expect(denied).toEqual([])
      expect(answered).toEqual([])
      const deny = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
        button.textContent?.trim().startsWith('Deny'),
      )
      await React.act(async () => deny?.click())
      expect(denied).toEqual(['ask-later'])
    } finally {
      await React.act(async () => root.unmount())
      host.remove()
    }
  })

  test('exposes ask choices as pressed controls with declared number shortcuts', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { AskInteractionView } = await import('./AskInteractionView')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const submissions: unknown[] = []
    const interaction: PendingAskInteraction = {
      kind: 'ask',
      request: {
        id: 'ask-1',
        kind: 'ask',
        payload: {
          toolCallId: 'ask-1',
          loading_messages: ['Waiting for your decision'],
          questions: [
            {
              id: 'direction',
              question: 'Which direction?',
              options: [{ label: 'Fast' }, { label: 'Careful', value: 'careful' }],
              recommended: 1,
            },
          ],
        },
      },
    }

    try {
      await act(async () => {
        root.render(
          <AskInteractionView
            interaction={interaction}
            submitting={false}
            onSubmit={(_requestId, answers) => submissions.push(answers)}
            onDismiss={() => {}}
          />,
        )
      })

      const choices = host.querySelector(
        '[role="group"][aria-label="Answers for Which direction?"]',
      )
      const fast = [...(choices?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
        (button) => button.textContent?.includes('Fast'),
      )
      const careful = [...(choices?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
        (button) => button.textContent?.includes('Careful'),
      )
      expect(fast?.getAttribute('aria-pressed')).toBe('false')
      expect(fast?.getAttribute('aria-keyshortcuts')).toBe('1')
      expect(careful?.getAttribute('aria-pressed')).toBe('true')
      expect(careful?.getAttribute('aria-keyshortcuts')).toBe('2')

      const custom = host.querySelector<HTMLInputElement>(
        'input[aria-label="Custom answer for Which direction?"]',
      )
      expect(custom?.getAttribute('data-slot')).toBe('input')
      expect(custom?.className).toContain('h-[var(--chrome-control-xl)]')

      await act(async () => fast?.click())
      expect(fast?.getAttribute('aria-pressed')).toBe('true')
      // `Approve`, the same word every other card's affirmative carries — an ask used to end
      // in `Continue`, which named the navigation rather than the answer.
      const submit = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
        button.textContent?.trim().startsWith('Approve'),
      )
      expect(submit?.getAttribute('data-variant')).toBe('mono')
      await act(async () => submit?.click())
      expect(submissions).toEqual([
        [
          {
            id: 'direction',
            question: 'Which direction?',
            selectedOptions: ['Fast'],
          },
        ],
      ])
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('keeps secret input masked, shared, and value-free after submit', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { SecretInteractionView } = await import('./SecretInteractionView')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const submissions: Array<[string, string]> = []
    const interaction: PendingRequestSecretInteraction = {
      kind: 'request_secret',
      request: {
        id: 'secret-1',
        kind: 'request_secret',
        payload: {
          action: 'create',
          key: 'DEPLOY_TOKEN',
          reason: 'Deploy the approved release',
          type: 'api_key',
          tags: [],
        },
      },
    }

    try {
      await act(async () => {
        root.render(
          <SecretInteractionView
            interaction={interaction}
            submitting={false}
            onSubmit={(requestId, value) => submissions.push([requestId, value])}
            onDismiss={() => {}}
          />,
        )
      })

      const input = host.querySelector<HTMLInputElement>('input[type="password"]')
      expect(input?.getAttribute('data-slot')).toBe('input')
      expect(input?.autocomplete).toBe('off')
      const submit = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
        button.textContent?.includes('Approve'),
      )
      expect(submit?.disabled).toBe(true)

      await act(async () => setInputValue(input!, 'vault-only-value'))
      expect(submit?.disabled).toBe(false)
      await act(async () => submit?.click())
      expect(submissions).toEqual([['secret-1', 'vault-only-value']])
      expect(input?.value).toBe('')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})

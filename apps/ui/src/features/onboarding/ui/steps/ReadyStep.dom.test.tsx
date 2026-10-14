import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

// Every import of react-dom, the step, and its stores is DYNAMIC and inside the
// test body: bun evaluates each file's module graph before any `beforeAll` runs,
// so a static import would initialize react-dom with no `document` and break
// unrelated DOM suites in the same process (see `domTestSetup`).

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})
afterEach(() => {
  localStorage.clear()
})

const CONNECTION = {
  id: 'conn-1',
  providerId: 'anthropic',
  providerName: 'Anthropic',
  label: 'Anthropic',
  authType: 'api-key' as const,
  hasApiKey: true,
  keyCount: 1,
  keys: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

/** The project whose settings hold what new chats start on — where the Provider step writes. */
const PROJECT = {
  id: 'PRJ-1',
  userId: 'u',
  name: 'Default',
  workingDir: '/tmp/workspace',
  settings: null as { modelId?: string; providerConnectionId?: string } | null,
  isDefault: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

/**
 * Mount the step against a seeded connection store and the project the Provider step wrote the
 * `{connection, model}` pair to — the same field every new chat's model chain consults.
 */
async function setup(options: {
  connections?: (typeof CONNECTION)[]
  connectionId?: string
  modelId?: string
  onJumpTo?: (stepId: string) => void
  onComplete?: () => void
}) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ReadyStep } = await import('./ReadyStep')
  const { useChatStore } = await import('@/features/chat/model/store')

  useChatStore.setState({
    connections: options.connections ?? [],
    refreshConnections: async () => {},
    loadProjects: async () => {},
    projects: [
      {
        ...PROJECT,
        settings:
          options.connectionId || options.modelId
            ? {
                ...(options.modelId ? { modelId: options.modelId } : {}),
                ...(options.connectionId ? { providerConnectionId: options.connectionId } : {}),
              }
            : null,
      },
    ],
  } as never)

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () =>
    root.render(
      <ReadyStep
        onComplete={options.onComplete ?? (() => {})}
        onSkip={() => {}}
        onJumpTo={options.onJumpTo ?? (() => {})}
      />,
    ),
  )
  return {
    container,
    text: () => container.textContent ?? '',
    buttons: (label: string) =>
      [...container.querySelectorAll('button')].filter((b) => b.textContent === label),
    click: async (element: Element) => {
      await act(async () => {
        ;(element as HTMLElement).click()
      })
    },
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

describe('the onboarding activation summary', () => {
  test('reads back the wired provider and model, and offers to start', async () => {
    const ui = await setup({
      connections: [CONNECTION],
      connectionId: 'conn-1',
      modelId: 'claude-fable-5',
    })
    try {
      expect(ui.text()).toContain("You're all set")
      expect(ui.text()).toContain('Anthropic')
      expect(ui.text()).toContain('claude-fable-5')
      expect(ui.text()).toContain('Start chatting')
    } finally {
      await ui.unmount()
    }
  })

  /**
   * The dead end this step exists to prevent: a persisted pair whose connection
   * is gone must not read as ready.
   */
  test('reports a stale pair whose connection no longer exists as unwired', async () => {
    const ui = await setup({
      connections: [],
      connectionId: 'conn-gone',
      modelId: 'claude-fable-5',
    })
    try {
      expect(ui.text()).toContain('No model connected')
      expect(ui.text()).toContain('Connect a provider')
      expect(ui.text()).toContain('Finish without a model')
    } finally {
      await ui.unmount()
    }
  })

  test('names the connected provider when only the model is missing', async () => {
    const ui = await setup({ connections: [CONNECTION], connectionId: 'conn-1' })
    try {
      expect(ui.text()).toContain('Anthropic is connected, but no default model is picked yet.')
    } finally {
      await ui.unmount()
    }
  })

  test('sends the user back to the step that owns each choice', async () => {
    const jumps: string[] = []
    const ui = await setup({
      connections: [CONNECTION],
      connectionId: 'conn-1',
      modelId: 'claude-fable-5',
      onJumpTo: (id) => jumps.push(id),
    })
    try {
      // Only the connection and model need confirmation; appearance is not a setup step.
      const changes = ui.buttons('Change')
      expect(changes.length).toBe(2)
      expect(ui.text()).not.toContain('Appearance')
      for (const button of changes) await ui.click(button)
      expect(jumps).toEqual(['provider', 'provider'])
    } finally {
      await ui.unmount()
    }
  })
})

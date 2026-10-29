import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { ToolCallItem } from '@localixai/agent/agents'
import { registerDom } from '@localixai/kit/testing/dom'
import { compileLikeTheBuild } from '@/testing/reactCompiler'

// The transcript's dispatcher as the desktop build ships it.
compileLikeTheBuild(/tool-parts\/ItemView\.tsx$/)

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

const call = (name: string, extra: Partial<ToolCallItem> = {}): ToolCallItem => ({
  id: `item-${name}`,
  type: 'tool_call',
  status: 'completed',
  toolCallId: `call-${name}`,
  name,
  activeVerb: 'Running',
  input: {},
  ...extra,
})

/** Mount one item with the transcript marked ours or foreign, and expose its DOM. */
async function mount(item: ToolCallItem, isForeign: boolean) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router')
  const { ForeignTranscriptContext } = await import('./foreignTranscriptContext')
  const { ItemView } = await import('./ItemView')
  const { WorkItemSessionProvider } = await import('@localixai/mini-app-sdk/ui/work-item-session')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)

  // Every transcript belongs to a chat; a card's open actions act for it and exist only inside one.
  await act(async () =>
    root.render(
      <MemoryRouter>
        <WorkItemSessionProvider sessionId="transcript-session">
          <ForeignTranscriptContext.Provider value={isForeign}>
            <ItemView item={item} />
          </ForeignTranscriptContext.Provider>
        </WorkItemSessionProvider>
      </MemoryRouter>,
    ),
  )
  return {
    act,
    host,
    /** The card header's primary label — what identifies WHICH card rendered. */
    title: () => host.querySelector('[data-slot="tool-line-title"]')?.textContent ?? '',
    expand: async () => {
      const header = host.querySelector<HTMLButtonElement>('button[aria-expanded]')
      if (header) await act(async () => header.click())
    },
    dispose: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('ItemView in a foreign transcript', () => {
  test('a `Read` call from our own agent still resolves the rich file card', async () => {
    const item = call('Read', { input: { path: '/repo/src/notes.ts' } })
    const view = await mount(item, false)
    try {
      expect(view.title()).toBe('notes.ts')
      expect(view.host.querySelector('button[aria-label="Open"]')).not.toBeNull()
    } finally {
      await view.dispose()
    }
  })

  test('an identically named `Read` call from a foreign agent falls to IN/OUT', async () => {
    // Same name, a payload our ReadCard would silently mis-read: no `path`, so
    // the rich card would render a file row naming nothing.
    const item = call('Read', { input: { file: '/elsewhere/other.ts', limit: 40 } })
    const view = await mount(item, true)
    try {
      expect(view.title()).toBe('Read')
      expect(view.host.querySelector('button[aria-label="Open"]')).toBeNull()
      await view.expand()
      expect(view.host.textContent).toContain('"file": "/elsewhere/other.ts"')
    } finally {
      await view.dispose()
    }
  })

  test('a foreign `AskUserQuestion` never opens our HITL card', async () => {
    const item = call('AskUserQuestion', {
      input: { questions: [{ id: 'q1', question: 'Which branch?', options: [] }] },
    })
    const ours = await mount(item, false)
    try {
      expect(ours.title()).toBe('Which branch?')
    } finally {
      await ours.dispose()
    }

    const foreign = await mount(item, true)
    try {
      expect(foreign.title()).toBe('AskUserQuestion')
      expect(foreign.host.textContent).not.toContain('Which branch?')
    } finally {
      await foreign.dispose()
    }
  })

  test('a foreign navigation-shaped output never becomes a host navigation button', async () => {
    const item = call('open_thing', {
      output: {
        type: 'ui.navigate',
        uri: 'localix://resource/foreign-demo/thing-1',
        label: 'Open dashboard',
      },
    })
    const ours = await mount(item, false)
    try {
      expect(ours.host.querySelector('button')?.textContent).toContain('Open dashboard')
    } finally {
      await ours.dispose()
    }

    const foreign = await mount(item, true)
    try {
      expect(foreign.title()).toBe('open_thing')
      expect(foreign.host.textContent).not.toContain('Open dashboard')
    } finally {
      await foreign.dispose()
    }
  })
})

describe('tool actions', () => {
  test('a registered action renders in its owning generic tool row', async () => {
    const stream = call('extension_stream', {
      status: 'running',
      actions: [
        {
          toolCallId: 'call-extension_stream',
          action: 'kill',
          label: 'Stop stream',
          icon: 'square',
          tone: 'danger',
        },
      ],
    })
    const view = await mount(stream, false)
    try {
      const stop = view.host.querySelector<HTMLButtonElement>('button[aria-label="Stop stream"]')
      expect(stop).not.toBeNull()
      expect(stop?.textContent).toBe('')
      expect(stop?.querySelector('.lucide-square')).not.toBeNull()
      expect(stop?.getAttribute('data-slot')).toBe('button')
      expect(stop?.getAttribute('data-size')).toBe('icon-xs')
      expect(stop?.getAttribute('data-tooltip-trigger')).toBe('true')
      expect(stop?.getAttribute('title')).toBeNull()

      const disclosure = view.host.querySelector<HTMLButtonElement>('button[aria-expanded]')
      expect(disclosure?.getAttribute('aria-expanded')).toBe('false')
      expect(disclosure?.contains(stop!)).toBe(false)
      expect(stop?.closest('[role="group"]')?.getAttribute('aria-label')).toBe(
        'extension_stream actions',
      )
      stop?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      expect(disclosure?.getAttribute('aria-expanded')).toBe('false')
    } finally {
      await view.dispose()
    }
  })
})

describe('subagent cards', () => {
  const subtitle = (host: HTMLElement) =>
    host.querySelector('[data-slot="tool-line-subtitle"]')?.textContent ?? ''

  test('an Agent call is titled by what it was asked, its subagent type beneath', async () => {
    const item = call('Agent', {
      input: {
        description: 'Find endpoints',
        prompt: 'List every route.',
        subagent_type: 'Explore',
      },
      resultText: 'started "Find endpoints" in the background.',
    })
    const view = await mount(item, false)
    try {
      expect(view.title()).toBe('Find endpoints')
      expect(subtitle(view.host)).toBe('Explore')
      await view.expand()
      expect(view.host.textContent).toContain('List every route.')
      expect(view.host.textContent).toContain('started "Find endpoints" in the background.')
    } finally {
      await view.dispose()
    }
  })

  test('an Agent call without a type, and a fork, say which they are', async () => {
    for (const [type, title] of [
      [undefined, 'Agent'],
      ['fork', 'Fork'],
    ] as const) {
      const view = await mount(
        call('Agent', { input: { description: 'Audit', prompt: 'x', subagent_type: type } }),
        false,
      )
      try {
        expect(view.title()).toBe('Audit')
        expect(subtitle(view.host)).toBe(title)
      } finally {
        await view.dispose()
      }
    }
  })

  test('SendMessage and TaskStop name the subagent they reached', async () => {
    const message = await mount(
      call('SendMessage', { input: { to: 'reviewer', message: 'Also check logout.' } }),
      false,
    )
    try {
      expect(message.title()).toBe('Message to reviewer')
      expect(subtitle(message.host)).toBe('Also check logout.')
    } finally {
      await message.dispose()
    }
    const stop = await mount(call('TaskStop', { input: { task_id: 'bg-2' } }), false)
    try {
      expect(stop.title()).toBe('Stop bg-2')
    } finally {
      await stop.dispose()
    }
  })
})

describe('ItemView and a mini app card', () => {
  test("a mini app's card registered after the call painted replaces the generic one", async () => {
    const { setEnabledMiniAppNames } = await import('@/shared/contrib/miniAppActivation')
    const { registerToolCard, removeToolCardsOf } = await import('@/shared/contrib/toolCards')
    setEnabledMiniAppNames(new Set(['late-card']))
    const view = await mount(call('late_board'), false)
    try {
      expect(view.host.textContent).not.toContain('Board card')
      await view.act(async () =>
        registerToolCard({
          tool: 'late_board',
          miniAppName: 'late-card',
          presentation: {
            label: 'Board',
            noun: 'boards',
            verb: 'Updating',
            Icon: () => null,
            stackable: false,
          },
          Component: () => <p>Board card</p>,
        }),
      )
      expect(view.host.textContent).toContain('Board card')
    } finally {
      await view.dispose()
      removeToolCardsOf('late-card')
      setEnabledMiniAppNames(null)
    }
  })
})

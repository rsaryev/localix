import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  spyOn,
  test,
} from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { Message, UiSession } from '@/shared/api/contracts'
import { backendClient } from '@/shared/api/client'
import { useChatStore } from '@/entities/chat/model/store'
import { CMD } from '@/shared/lib/keybindings/command-ids'
import { setUiCommands } from '@/shared/contrib/uiCommands'
import { subscribeChatChrome } from '@/shared/lib/chatChromeBus'
import { bindMiniAppUiRuntime, type MiniAppUiRuntime } from '@localixai/mini-app-sdk/ui/runtime'
import { toast } from '@/shared/lib/notify'
import { subscribeSettingsNav, consumeSettingsNav } from '@/shared/lib/settingsNavBus'
import { registerInspectorHandler } from '@/shared/lib/inspectorBus'
import type { ContextUsageInput } from '../../model/contextUsageView'
import type { ComposerCommands } from './useComposerCommands'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())
beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

const message = (id: string, role: Message['role'], content: string, extra = {}) =>
  ({ id, role, content, ...extra }) as Message
const chat = (id: string, title: string, updatedAt: number, messages: Message[] = []) =>
  ({
    id,
    title,
    seq: 1,
    updatedAt,
    messages,
    projectId: 'p1',
    sessionKind: 'chat',
    isPinned: false,
    isArchived: false,
    queuedMessages: [],
  }) as unknown as UiSession

const transcript = [
  message('u1', 'user', 'refactor the parser'),
  message('a1', 'assistant', 'first reply'),
  message('u2', 'user', 'now add tests'),
  message('a2', 'assistant', 'second reply'),
]

interface Spies {
  rollbacks: string[]
  sent: string[]
  opened: string[]
  newChats: number
  pickers: number
  settings: { tab: string }[]
  copied: string[]
  prompts: string[]
}

/** The composer's command wiring as PromptInput has it: the arg menu, then Enter runs the command. */
async function mount(
  initial: string,
  options: { onRollback?: boolean; context?: ContextUsageInput } = {},
) {
  const { act, useState } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useComposerCommands } = await import('./useComposerCommands')
  const { useSlashArgOptions } = await import('./useSlashArgOptions')
  const { useClientCommands } = await import('./useClientCommands')
  const { CommandChipPrefix } = await import('./CommandChipPrefix')
  const spies: Spies = {
    rollbacks: [],
    sent: [],
    opened: [],
    newChats: 0,
    pickers: 0,
    settings: [],
    copied: [],
    prompts: [],
  }
  const state = { composer: null as unknown as ComposerCommands, handled: false }
  function Harness() {
    const [prompt, setPrompt] = useState(initial)
    spies.prompts.push(prompt)
    const load = useSlashArgOptions('s1', 'p1')
    const client = useClientCommands({
      sessionId: 's1',
      setPrompt,
      onSend: (text) => spies.sent.push(text),
      onRollback: options.onRollback === false ? undefined : (id) => spies.rollbacks.push(id),
      openChat: (id) => spies.opened.push(id),
      context: options.context ?? { contextWindow: 200_000 },
    })
    state.composer = useComposerCommands(prompt, setPrompt, [], load)
    const run = (key: string) => {
      state.handled = state.composer.handleKeyDown({ key, preventDefault() {} } as never)
      if (!state.handled && key === 'Enter')
        state.handled = client.submit(state.composer.slash.detected)
    }
    ;(state as { run?: typeof run }).run = run
    return (
      <div>
        <CommandChipPrefix slash={state.composer.slash} slashArgs={state.composer.slashArgs} />
        <span data-testid="prompt">{prompt}</span>
        {client.confirmation}
      </div>
    )
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<Harness />))
  const press = (key: string) =>
    act(async () => (state as unknown as { run: (k: string) => void }).run(key))
  /** The arg menu loads after its debounce; drain the faked clock and the promises it starts. */
  const settle = () =>
    act(async () => {
      jest.advanceTimersByTime(250)
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
  const options_ = () => state.composer.slashArgs.options.map((row) => row.label)
  const prompt = () => host.querySelector('[data-testid="prompt"]')!.textContent
  const unmount = async () => {
    await act(async () => root.unmount())
    host.remove()
  }
  return { act, spies, state, press, settle, options: options_, prompt, host, unmount }
}

let originalStore: ReturnType<typeof useChatStore.getState>
let restoreRename: (() => void) | undefined
beforeEach(() => {
  originalStore = useChatStore.getState()
  const sessions = [
    chat('s1', 'Parser work', 300, transcript),
    chat('s2', 'Older notes', 100),
    chat('s3', 'Release plan', 200),
  ]
  useChatStore.setState({ sessions, allSessions: sessions, activeSessionId: 's1' })
})
afterEach(() => {
  useChatStore.setState(originalStore, true)
  restoreRename?.()
  restoreRename = undefined
  setUiCommands([])
  consumeSettingsNav()
})

describe('/rewind in the composer', () => {
  test('typing /rew offers it, its crumbs are your messages newest first, and Enter asks before rolling back', async () => {
    const ui = await mount('/rew')
    try {
      expect(ui.state.composer.slash.filtered.map((c) => c.id)).toEqual(['rewind'])
      await ui.press('Enter')
      expect(ui.prompt()).toBe('/rewind ')
      await ui.settle()
      expect(ui.options()).toEqual(['now add tests', 'refactor the parser'])
      await ui.press('Enter')
      expect(ui.prompt()).toBe('/rewind u2 ')
      // Enter runs it: nothing is rolled back until the question is answered.
      await ui.press('Enter')
      expect(ui.state.handled).toBe(true)
      expect(ui.spies.rollbacks).toEqual([])
      expect(ui.prompt()).toBe('')
      const confirm = [...document.body.querySelectorAll('button')].find(
        (button) => button.textContent === 'Roll back',
      )!
      await ui.act(async () => confirm.click())
      expect(ui.spies.rollbacks).toEqual(['u2'])
    } finally {
      await ui.unmount()
    }
  })

  test('cancelling the question rolls nothing back', async () => {
    const ui = await mount('/rewind u1 ')
    try {
      await ui.press('Enter')
      const cancel = [...document.body.querySelectorAll('button')].find(
        (button) => button.textContent === 'Cancel',
      )!
      await ui.act(async () => cancel.click())
      expect(ui.spies.rollbacks).toEqual([])
    } finally {
      await ui.unmount()
    }
  })

  test('a surface that cannot roll back leaves the text for the server to answer', async () => {
    const ui = await mount('/rewind u1 ', { onRollback: false })
    try {
      await ui.press('Enter')
      expect(ui.state.handled).toBe(false)
    } finally {
      await ui.unmount()
    }
  })
})

describe('/resume in the composer', () => {
  test('lists the other recent chats and opens the chosen one', async () => {
    const ui = await mount('/resume ')
    try {
      await ui.settle()
      expect(ui.options()).toEqual(['Release plan', 'Older notes'])
      // Enter alone runs the command (the picker); choosing a row starts with an arrow key.
      await ui.press('ArrowDown')
      await ui.press('Enter')
      expect(ui.prompt()).toBe('/resume s2 ')
      await ui.press('Enter')
      expect(ui.spies.opened).toEqual(['s2'])
    } finally {
      await ui.unmount()
    }
  })

  test('Enter with no chat opens the chat picker', async () => {
    const stop = subscribeChatChrome(() => void 0)
    const events: string[] = []
    const off = subscribeChatChrome((event) => events.push(event))
    const ui = await mount('/resume ')
    try {
      await ui.settle()
      // The empty, optional crumb leaves Enter to run the command.
      await ui.press('Enter')
      expect(ui.spies.opened).toEqual([])
      expect(events).toEqual(['session-switcher'])
    } finally {
      stop()
      off()
      await ui.unmount()
    }
  })
})

describe('/clear in the composer', () => {
  test('runs the app’s new-chat command and empties the draft', async () => {
    let started = 0
    setUiCommands([
      { id: CMD.newChat, label: 'New chat', effect: 'write', run: () => void started++ },
    ])
    const ui = await mount('/clear')
    try {
      await ui.press('Enter')
      expect(started).toBe(1)
      expect(ui.prompt()).toBe('')
    } finally {
      await ui.unmount()
    }
  })

  test('is left to the server on a surface with no new-chat command', async () => {
    const ui = await mount('/clear')
    try {
      await ui.press('Enter')
      expect(ui.state.handled).toBe(false)
      expect(ui.prompt()).toBe('/clear')
    } finally {
      await ui.unmount()
    }
  })
})

describe('/rename in the composer', () => {
  test('gives the chat the title typed, through the rename the sidebar uses', async () => {
    const updates: unknown[][] = []
    const original = backendClient.updateSession.bind(backendClient)
    backendClient.updateSession = (async (...args: unknown[]) => void updates.push(args)) as never
    restoreRename = () => void (backendClient.updateSession = original)
    const ui = await mount('/rename Parser rewrite')
    try {
      expect(ui.state.composer.slashArgs.activeSpec?.name).toBe('title')
      await ui.press('Enter')
      expect(updates).toEqual([['s1', { title: 'Parser rewrite' }]])
    } finally {
      await ui.unmount()
    }
  })

  test('without a title it says how to use it and renames nothing', async () => {
    const say = spyOn(toast, 'message').mockImplementation((() => '') as never)
    const ui = await mount('/rename ')
    try {
      await ui.press('Enter')
      expect(say).toHaveBeenCalledWith('Usage: /rename <title>')
    } finally {
      say.mockRestore()
      await ui.unmount()
    }
  })
})

describe('/plan in the composer', () => {
  test('switches the chat to Plan mode first, then sends the task', async () => {
    const events: string[] = []
    const original = backendClient.updateSession.bind(backendClient)
    backendClient.updateSession = (async (_id: string, patch: { permissionMode?: string }) =>
      void events.push(`mode:${patch.permissionMode}`)) as never
    restoreRename = () => void (backendClient.updateSession = original)
    const ui = await mount('/plan map the migration')
    try {
      ui.spies.sent.push = ((text: string) => events.push(`send:${text}`)) as never
      await ui.press('Enter')
      expect(events).toEqual(['mode:plan', 'send:map the migration'])
    } finally {
      await ui.unmount()
    }
  })

  test('with no task it only switches the mode', async () => {
    const events: string[] = []
    const original = backendClient.updateSession.bind(backendClient)
    backendClient.updateSession = (async (_id: string, patch: { permissionMode?: string }) =>
      void events.push(`mode:${patch.permissionMode}`)) as never
    restoreRename = () => void (backendClient.updateSession = original)
    const ui = await mount('/plan ')
    try {
      await ui.press('Enter')
      expect(events).toEqual(['mode:plan'])
      expect(ui.spies.sent).toEqual([])
    } finally {
      await ui.unmount()
    }
  })
})

describe('/copy in the composer', () => {
  test('/copy 2 copies the second latest reply, as the card’s Copy text does', async () => {
    const written: string[] = []
    const unbind = bindMiniAppUiRuntime({
      clipboard: {
        writeText: async (text: string) => {
          written.push(text)
          return true
        },
      },
    } as unknown as MiniAppUiRuntime)
    const ui = await mount('/copy ')
    try {
      await ui.settle()
      expect(ui.options()).toEqual(['second reply', 'first reply'])
      await ui.press('ArrowDown')
      await ui.press('Enter')
      expect(ui.prompt()).toBe('/copy 2 ')
      await ui.press('Enter')
      expect(written).toEqual(['first reply'])
    } finally {
      unbind()
      await ui.unmount()
    }
  })

  test('/copy alone copies the latest reply', async () => {
    const written: string[] = []
    const unbind = bindMiniAppUiRuntime({
      clipboard: {
        writeText: async (text: string) => {
          written.push(text)
          return true
        },
      },
    } as unknown as MiniAppUiRuntime)
    const ui = await mount('/copy ')
    try {
      await ui.press('Enter')
      expect(written).toEqual(['second reply'])
    } finally {
      unbind()
      await ui.unmount()
    }
  })
})

describe('/context, /permissions and /config in the composer', () => {
  test('/context reports the share the usage indicator computes', async () => {
    const say = spyOn(toast, 'message').mockImplementation((() => '') as never)
    const ui = await mount('/context', {
      context: { contextWindow: 200_000, usage: { contextTokens: 50_000 } as never },
    })
    try {
      await ui.press('Enter')
      expect(say).toHaveBeenCalledWith('Context 25% full', {
        description: '50.0k of 200.0k tokens.',
      })
    } finally {
      say.mockRestore()
      await ui.unmount()
    }
  })

  for (const [command, tab] of [
    ['/permissions', 'permissions'],
    ['/config', 'preferences'],
  ] as const) {
    test(`${command} opens Settings at ${tab}`, async () => {
      const requests: string[] = []
      const stopInspector = registerInspectorHandler((request) => requests.push(request.kind))
      const tabs: string[] = []
      const stopNav = subscribeSettingsNav((target) => tabs.push(target.tab))
      const ui = await mount(command)
      try {
        await ui.press('Enter')
        expect(requests).toEqual(['settings'])
        expect(tabs).toEqual([tab])
      } finally {
        stopNav()
        stopInspector()
        await ui.unmount()
      }
    })
  }
})

describe('crumbs of commands the server runs', () => {
  test('/help offers the command names and a choice becomes /help <command>', async () => {
    const ui = await mount('/help ')
    try {
      await ui.settle()
      expect(ui.options()).toContain('/rewind')
      expect(ui.options()).not.toContain('/reload-plugins')
      await ui.press('ArrowDown')
      await ui.press('Enter')
      expect(ui.prompt()).toMatch(/^\/help [a-z-]+ $/)
      // The server answers `/help <command>`: nothing here intercepts it.
      await ui.press('Enter')
      expect(ui.state.handled).toBe(false)
    } finally {
      await ui.unmount()
    }
  })

  test('/output-style offers default and the styles the chat can pick', async () => {
    const original = backendClient.listOutputStyles.bind(backendClient)
    backendClient.listOutputStyles = (async () => [
      { name: 'Concise', source: 'builtin', description: 'Short', forced: false },
      { name: 'acme:loud', source: 'plugin', description: '', forced: true },
    ]) as never
    const ui = await mount('/output-style ')
    try {
      await ui.settle()
      expect(ui.options()).toEqual(['default', 'Concise'])
    } finally {
      backendClient.listOutputStyles = original
      await ui.unmount()
    }
  })

  test('/memory takes the fact as text, left for the server', async () => {
    const ui = await mount('/memory prefer tabs')
    try {
      expect(ui.state.composer.slashArgs.activeSpec?.name).toBe('fact')
      await ui.press('Enter')
      expect(ui.state.handled).toBe(false)
    } finally {
      await ui.unmount()
    }
  })
})

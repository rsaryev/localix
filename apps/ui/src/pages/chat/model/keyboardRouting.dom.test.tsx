import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { isPrimaryModifier } from '@localixai/kit/keybindings'
import { useFocusStack, DEFAULT_KEY_POLICY } from '@localixai/plugin-sdk/ui/focus'
import { CMD } from '@/shared/lib/keybindings/catalog'
import { useKeybindingsStore } from '@/shared/lib/keybindings/store'
import { clearActionHandlers, registerActionHandler } from '@/shared/lib/actions/registry'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())
afterEach(() => {
  clearActionHandlers()
  useFocusStack.getState().reset()
  useKeybindingsStore.getState().setOverrides(undefined)
})

const primary = isPrimaryModifier({ metaKey: true, ctrlKey: false })
  ? { metaKey: true }
  : { ctrlKey: true }

async function mount() {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { ActionRegistryProvider } = await import('@/shared/lib/actions/ActionRegistryProvider')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <ActionRegistryProvider>
        <div />
      </ActionRegistryProvider>,
    ),
  )
  const fire = (target: EventTarget, key: string, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
    target.dispatchEvent(event)
    return event
  }
  return {
    host,
    root,
    act,
    fire,
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('keyboard dispatch follows DOM focus', () => {
  test('terminal clear, links, find and prompt navigation win before workspace commands', async () => {
    const { classifyTerminalKey } = await import('@/features/terminal/model/terminalKeymap')
    const view = await mount()
    const terminal = document.createElement('textarea')
    view.host.append(terminal)
    const calls: string[] = []
    for (const id of [CMD.switchSession, CMD.goToSymbol, CMD.findInChat, CMD.toggleSidebar]) {
      registerActionHandler({ commandId: id, run: () => calls.push(id) })
    }
    terminal.addEventListener('keydown', (event) => {
      const action = classifyTerminalKey(event)
      if (action === 'passthrough') return
      calls.push(action)
      event.preventDefault()
      event.stopPropagation()
    })
    try {
      for (const [key, shiftKey] of [
        ['k', false],
        ['o', true],
        ['f', false],
        ['ArrowUp', false],
        ['ArrowDown', false],
      ] as const) {
        expect(view.fire(terminal, key, { ...primary, shiftKey }).defaultPrevented).toBe(true)
      }
      expect(calls).toEqual(['clear', 'open-links', 'find', 'jump-prev', 'jump-next'])
      view.fire(terminal, 'b', primary)
      view.fire(document.body, 'k', primary)
      expect(calls.slice(5)).toEqual([CMD.toggleSidebar, CMD.switchSession])
    } finally {
      await view.unmount()
    }
  })

  test('editor, canvas and tree native handlers keep claimed chords even after rebinding', async () => {
    const view = await mount()
    let opened = 0
    useKeybindingsStore.getState().setOverrides({ [CMD.switchSession]: 'mod+e' })
    registerActionHandler({
      commandId: CMD.switchSession,
      run: () => {
        opened += 1
      },
    })
    try {
      for (const tag of ['textarea', 'div', 'button']) {
        const owner = document.createElement(tag)
        view.host.append(owner)
        owner.addEventListener('keydown', (event) => event.preventDefault())
        view.fire(owner, 'e', primary)
      }
      expect(opened).toBe(0)
      view.fire(document.body, 'e', primary)
      expect(opened).toBe(1)
    } finally {
      await view.unmount()
    }
  })

  test('React input handlers run before a colliding global command', async () => {
    const view = await mount()
    const { ActionRegistryProvider } = await import('@/shared/lib/actions/ActionRegistryProvider')
    let local = 0
    let global = 0
    useKeybindingsStore.getState().setOverrides({ [CMD.switchSession]: 'mod+enter' })
    registerActionHandler({
      commandId: CMD.switchSession,
      run: () => {
        global += 1
      },
    })
    try {
      await view.act(async () =>
        view.root.render(
          <ActionRegistryProvider>
            <textarea
              onKeyDown={(event) => {
                local += 1
                event.preventDefault()
              }}
            />
          </ActionRegistryProvider>,
        ),
      )
      view.fire(view.host.querySelector('textarea')!, 'Enter', primary)
      expect({ local, global }).toEqual({ local: 1, global: 0 })
    } finally {
      await view.unmount()
    }
  })

  test('bare rebindings preserve fields, rich text descendants, and select navigation', async () => {
    const view = await mount()
    let opened = 0
    registerActionHandler({
      commandId: CMD.switchSession,
      run: () => {
        opened += 1
      },
    })
    try {
      for (const key of ['k', 'ArrowDown', 'Delete', 'Enter']) {
        useKeybindingsStore.getState().setOverrides({ [CMD.switchSession]: key.toLowerCase() })
        for (const tag of ['input', 'textarea', 'select', 'div']) {
          const field = document.createElement(tag)
          if (tag === 'div') field.setAttribute('contenteditable', 'plaintext-only')
          view.host.append(field)
          const target = tag === 'div' ? field.appendChild(document.createElement('span')) : field
          expect(view.fire(target, key).defaultPrevented).toBe(false)
          field.remove()
        }
        view.fire(document.body, key)
      }
      expect(opened).toBe(4)
    } finally {
      await view.unmount()
    }
  })

  test('native clipboard, undo and rich text formatting survive colliding overrides', async () => {
    const view = await mount()
    let opened = 0
    registerActionHandler({
      commandId: CMD.switchSession,
      run: () => {
        opened += 1
      },
    })
    const field = view.host.appendChild(document.createElement('textarea'))
    const rich = view.host.appendChild(document.createElement('div'))
    rich.setAttribute('contenteditable', 'true')
    const child = rich.appendChild(document.createElement('span'))
    try {
      for (const key of ['a', 'c', 'x', 'v', 'z']) {
        useKeybindingsStore.getState().setOverrides({ [CMD.switchSession]: `mod+${key}` })
        expect(view.fire(field, key, primary).defaultPrevented).toBe(false)
        view.fire(document.body, key, primary)
      }
      useKeybindingsStore.getState().setOverrides({ [CMD.switchSession]: 'mod+b' })
      expect(view.fire(child, 'b', primary).defaultPrevented).toBe(false)
      expect(opened).toBe(5)
    } finally {
      await view.unmount()
    }
  })

  test('composition, AltGraph, and already handled events never run a workspace action', async () => {
    const view = await mount()
    let opened = 0
    registerActionHandler({
      commandId: CMD.switchSession,
      run: () => {
        opened += 1
      },
    })
    try {
      view.fire(document.body, 'k', { ...primary, isComposing: true })
      view.fire(document.body, 'k', { ...primary, keyCode: 229 })
      const altGraph = new KeyboardEvent('keydown', { key: 'k', ...primary, bubbles: true })
      Object.defineProperty(altGraph, 'getModifierState', { value: () => true })
      document.body.dispatchEvent(altGraph)
      const handled = new KeyboardEvent('keydown', {
        key: 'k',
        ...primary,
        bubbles: true,
        cancelable: true,
      })
      handled.preventDefault()
      document.body.dispatchEvent(handled)
      expect(opened).toBe(0)
    } finally {
      await view.unmount()
    }
  })

  test('F1 uses the same dispatcher and yields to local owners and dialogs', async () => {
    const view = await mount()
    let opened = 0
    registerActionHandler({
      commandId: CMD.commandPalette,
      run: () => {
        opened += 1
      },
    })
    try {
      view.fire(document.body, 'F1')
      const owner = document.createElement('div')
      view.host.append(owner)
      owner.addEventListener('keydown', (event) => event.preventDefault())
      view.fire(owner, 'F1')
      useFocusStack
        .getState()
        .push({ id: 'dialog', kind: 'dialog', keyboard: DEFAULT_KEY_POLICY.dialog })
      useFocusStack
        .getState()
        .push({ id: 'field', kind: 'text-input', keyboard: DEFAULT_KEY_POLICY['text-input'] })
      view.fire(document.body, 'F1')
      view.fire(document.body, 'p', { ...primary, shiftKey: true })
      expect(opened).toBe(1)
    } finally {
      await view.unmount()
    }
  })
})

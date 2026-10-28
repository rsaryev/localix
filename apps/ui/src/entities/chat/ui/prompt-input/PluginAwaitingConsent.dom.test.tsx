import { afterAll, afterEach, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { CapabilitySnapshot } from '@/shared/api/contracts'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  mock.restore()
  await teardown()
})
afterEach(async () => {
  const { __resetCapabilityCache } = await import('@/shared/contrib/capabilityCache')
  const { useChatStore } = await import('@/entities/chat/model/store')
  __resetCapabilityCache()
  useChatStore.setState({ sessions: [], allSessions: [] })
  document.body.innerHTML = ''
})

const plugin = (name: string, over: object = {}) => ({
  name,
  source: `${name}@${name}-market`,
  enabled: false,
  awaitingConsent: true,
  ...over,
})

/** What the server answers for a project with plugins that are installed, awaiting an OK. */
const snapshotWith = (plugins: object[]) =>
  ({
    revision: 1,
    scope: { projectId: 'p1', agentId: null },
    plugins,
    miniApps: [],
    tools: {
      enabled: [],
      disabled: [],
      catalog: [],
      categoryLabels: {},
      mcp: [],
      mcpUnprobedServers: [],
    },
    views: [],
    agents: [],
    commands: [],
    miniAppCommands: [],
    mcp: [],
    skills: [],
    tips: [],
    grammar: { kinds: [], effects: [], classes: [], examples: [] },
  }) as unknown as CapabilitySnapshot

/** The composer's slash menu for a typed prompt, as the person sees it. */
async function typeInComposer(prompt: string, plugins: object[]) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { backendClient } = await import('@/shared/api/client')
  const { useChatStore } = await import('@/entities/chat/model/store')
  const { useDynamicSlashCommands } = await import('./useDynamicSlashCommands')
  const { useSlashCommands } = await import('./slashCommands')
  const { SlashCommandMenu } = await import('./SlashCommandMenu')
  const { Autocomplete, AutocompleteAnchor } = await import('@localixai/kit/autocomplete')
  const session = { id: 's1', projectId: 'p1' } as never
  useChatStore.setState({ sessions: [session], allSessions: [session] })
  spyOn(backendClient, 'fetchCapabilitySnapshot').mockImplementation(async () =>
    snapshotWith(plugins),
  )
  const typed: string[] = []
  function Composer() {
    const [text, setText] = React.useState(prompt)
    const dynamic = useDynamicSlashCommands('s1', true)
    const slash = useSlashCommands(text, (value) => (typed.push(value), setText(value)), dynamic)
    return (
      <Autocomplete open>
        <AutocompleteAnchor asChild>
          <div data-testid="composer">{text}</div>
        </AutocompleteAnchor>
        {slash.isOpen && (
          <SlashCommandMenu
            commands={slash.filtered}
            query={slash.query}
            activeIndex={slash.activeIndex}
            onSelect={slash.handleSelect}
            onHover={slash.setActiveIndex}
          />
        )}
      </Autocomplete>
    )
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () => root.render(<Composer />))
  for (let turn = 0; turn < 10; turn++)
    await React.act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
  return {
    React,
    typed,
    options: () => [...document.querySelectorAll('[role="option"]')],
    composer: () => document.querySelector('[data-testid="composer"]')?.textContent,
    done: () => React.act(async () => root.unmount()),
  }
}

describe('a command of a plugin that waits for consent', () => {
  test('shows a row saying so, which opens the plugin in the Store', async () => {
    const { inspector } = await import('@/shared/lib/inspectorBus')
    const open = spyOn(inspector, 'openWorkItem').mockImplementation(() => {})
    const view = await typeInComposer('/tokendoctor:scan', [plugin('tokendoctor')])
    const rows = view.options()
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('tokendoctor is waiting for your OK'),
    ])
    await view.React.act(async () => (rows[0] as HTMLElement).click())
    expect(open).toHaveBeenCalledTimes(1)
    expect(open.mock.calls[0]?.[0]).toMatchObject({
      workKind: 'store',
      payload: { ref: { kind: 'plugin', id: 'tokendoctor@tokendoctor-market' } },
    })
    // Choosing it opens the page; it does not write a command nobody can run into the composer.
    expect(view.typed).toEqual([''])
    await view.done()
  })

  test('shows nothing for another name, an approved plugin or a bare slash', async () => {
    for (const [prompt, plugins] of [
      ['/other', [plugin('tokendoctor')]],
      ['/tokendoctor', [plugin('tokendoctor', { awaitingConsent: false, enabled: true })]],
      ['/', [plugin('tokendoctor')]],
    ] as const) {
      const { __resetCapabilityCache } = await import('@/shared/contrib/capabilityCache')
      __resetCapabilityCache()
      const view = await typeInComposer(prompt, [...plugins])
      expect(
        view
          .options()
          .map((row) => row.textContent)
          .join(''),
      ).not.toContain('waiting')
      await view.done()
      document.body.innerHTML = ''
    }
  })
})

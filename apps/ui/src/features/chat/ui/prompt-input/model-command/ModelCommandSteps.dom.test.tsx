import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ComposerCommands } from '../useComposerCommands'
import type { ModelCommandContext } from './modelCommandTarget'
import { context, member } from './modelCommandFixture'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

/** The composer's real command engine, chips and argument menu, fed `/model`'s step data. */
async function mount(ctx: ModelCommandContext, initial = '/model ') {
  const { act, useState } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useComposerCommands } = await import('../useComposerCommands')
  const { CommandChipPrefix } = await import('../CommandChipPrefix')
  const { SlashArgMenu } = await import('../SlashArgMenu')
  const { Autocomplete, AutocompleteAnchor } = await import('@localixai/kit/autocomplete')
  const { modelStepOptions, skipModelStep } = await import('./modelCommandSteps')
  const load = async (_c: unknown, arg: string, query: string, committed: Record<string, string>) =>
    modelStepOptions(ctx, arg, query, committed)
  const skip = (_c: unknown, name: string, committed: ReadonlyMap<string, string>) =>
    skipModelStep(ctx, name, committed)
  const state = { current: null as unknown as ComposerCommands, prompt: initial }
  function Harness() {
    const [value, setValue] = useState(initial)
    state.prompt = value
    state.current = useComposerCommands(value, setValue, [], load as never, skip as never)
    const { slashArgs } = state.current
    return (
      <Autocomplete open={slashArgs.isMenuOpen}>
        <AutocompleteAnchor asChild>
          <div>
            <CommandChipPrefix slash={state.current.slash} slashArgs={slashArgs} />
          </div>
        </AutocompleteAnchor>
        <SlashArgMenu
          options={slashArgs.options}
          activeIndex={slashArgs.activeIndex}
          onSelect={slashArgs.selectOption}
          onHover={slashArgs.setActiveIndex}
        />
      </Autocomplete>
    )
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  // The dynamic rows load after the hook's 200ms debounce.
  const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 260)))
  const key = (name: string) =>
    act(async () => {
      state.current.handleKeyDown({ key: name, preventDefault() {} } as never)
    })
  await act(async () => root.render(<Harness />))
  await settle()
  const listbox = () => document.body.querySelector('[role="listbox"]')
  const rows = () => [...document.body.querySelectorAll('[role="option"]')]
  const unmount = async () => {
    await act(async () => root.unmount())
    host.remove()
  }
  return { state, host, act, settle, key, listbox, rows, unmount }
}

test('a group walks Agents → Provider → Model → Settings with keyboard and mouse', async () => {
  const ui = await mount(
    context([
      member('lead', 'openai/gpt', 'high', { label: 'Lead' }),
      member('qa', 'anthropic/opus'),
    ]),
  )
  try {
    // Step 1, an accessible listbox of the room: All agents first.
    expect(ui.listbox()?.getAttribute('aria-label')).toBe('Command arguments')
    expect(ui.rows().map((row) => row.textContent)).toEqual([
      expect.stringContaining('All agents'),
      expect.stringContaining('Lead'),
      expect.stringContaining('@qa'),
    ])
    expect(ui.rows()[0]?.getAttribute('aria-selected')).toBe('true')
    await ui.key('ArrowDown')
    expect(ui.rows()[1]?.getAttribute('aria-selected')).toBe('true')
    await ui.key('Enter')
    expect(ui.state.prompt).toBe('/model @lead ')
    // The breadcrumb names the member as the menu did.
    expect(ui.host.querySelector('[title="agent: GPT · High"]')?.textContent).toContain('Lead')
    await ui.settle()
    // Step 2 by mouse.
    const openai = ui.rows().find((row) => row.textContent?.includes('OpenAI'))!
    await ui.act(async () => openai.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(ui.state.prompt).toBe('/model @lead conn-openai ')
    await ui.settle()
    expect(ui.state.current.slashArgs.activeSpec?.name).toBe('model')
    await ui.key('Tab')
    await ui.settle()
    // Step 4: only the levels GPT offers, Off included because it publishes it.
    expect(ui.state.current.slashArgs.options.map((row) => row.value)).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
    ])
    // Optional step: Enter without choosing submits instead of committing a row.
    expect(ui.state.current.handleKeyDown({ key: 'Enter', preventDefault() {} } as never)).toBe(
      false,
    )
    // Back: Backspace on an empty step clears the last crumb; the × clears from that crumb on.
    await ui.key('Backspace')
    expect(ui.state.prompt).toBe('/model @lead conn-openai ')
    const clearProvider = ui.host.querySelector('[aria-label="Clear provider"]')!
    await ui.act(async () =>
      clearProvider.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    )
    expect(ui.state.prompt).toBe('/model @lead ')
    expect(ui.state.current.slashArgs.activeSpec?.name).toBe('provider')
  } finally {
    await ui.unmount()
  }
})

test('a one-agent chat names its agent, and a non-reasoning model skips Reasoning', async () => {
  const ui = await mount(
    context([member('solo', 'openai/gpt')]),
    '/model @solo conn-openai openai/plain ',
  )
  try {
    expect(ui.state.current.slashArgs.chips.map((chip) => chip.spec.name)).toEqual([
      'agent',
      'provider',
      'model',
    ])
    expect(ui.state.current.slashArgs.activeSpec?.name).toBe('turns')
    expect(ui.rows()[0]?.textContent).toContain('Keep')
  } finally {
    await ui.unmount()
  }
})

test('All agents ends after Reasoning — the per-agent settings do not apply to the room', async () => {
  const ui = await mount(
    context([member('lead', 'openai/gpt'), member('qa', 'anthropic/opus')]),
    '/model all conn-anthropic anthropic/opus high ',
  )
  try {
    expect(ui.state.current.slashArgs.activeSpec).toBeNull()
    expect(ui.state.current.slashArgs.placeholder).toBe('Enter to run…')
    expect(ui.listbox()).toBeNull()
  } finally {
    await ui.unmount()
  }
})

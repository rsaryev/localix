import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ComposerCommands } from '../useComposerCommands'
import type { ModelCommandContext } from './modelCommandTarget'
import { turns } from '@/testing/settle'
import { agentRow, context } from './testing/modelCommandFixture'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

/** The composer's real command engine, chips and argument menu, fed `/model`'s step data. */
async function mount(ctx: ModelCommandContext, initial = '/model ') {
  const { act, useEffect, useState } = await import('react')
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
    const commands = useComposerCommands(value, setValue, [], load as never, skip as never, 0)
    useEffect(() => {
      state.prompt = value
      state.current = commands
    })
    const { slashArgs } = commands
    return (
      <Autocomplete open={slashArgs.isMenuOpen}>
        <AutocompleteAnchor asChild>
          <div>
            <CommandChipPrefix slash={commands.slash} slashArgs={slashArgs} />
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
  // The dynamic rows load after the hook's debounce timer (0 here); then the reads land.
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      await turns()
    })
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

test('the agent’s model walks Provider → Model → Settings with keyboard and mouse', async () => {
  const ui = await mount(context(agentRow('lead', 'openai/gpt', 'high', { name: 'lead' })))
  try {
    // Step 1, an accessible listbox of the connections.
    expect(ui.listbox()?.getAttribute('aria-label')).toBe('Command arguments')
    expect(ui.rows().map((row) => row.textContent)).toEqual([
      expect.stringContaining('Anthropic'),
      expect.stringContaining('OpenAI'),
    ])
    expect(ui.rows()[0]?.getAttribute('aria-selected')).toBe('true')
    await ui.key('ArrowDown')
    expect(ui.rows()[1]?.getAttribute('aria-selected')).toBe('true')
    await ui.key('Enter')
    expect(ui.state.prompt).toBe('/model conn-openai ')
    await ui.settle()
    expect(ui.state.current.slashArgs.activeSpec?.name).toBe('model')
    await ui.key('Tab')
    await ui.settle()
    // Reasoning: only the levels GPT offers, Off included because it publishes it.
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
  } finally {
    await ui.unmount()
  }
})

test('a non-reasoning model skips Reasoning', async () => {
  const ui = await mount(
    context(agentRow('solo', 'openai/gpt')),
    '/model conn-openai openai/plain ',
  )
  try {
    expect(ui.state.current.slashArgs.chips.map((chip) => chip.spec.name)).toEqual([
      'provider',
      'model',
    ])
    expect(ui.state.current.slashArgs.activeSpec?.name).toBe('turns')
    expect(ui.rows()[0]?.textContent).toContain('Keep')
  } finally {
    await ui.unmount()
  }
})

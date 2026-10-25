import { afterAll, afterEach, beforeAll, beforeEach, expect, jest, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ComposerCommands } from './useComposerCommands'
import { effortStepOptions, skipEffortStep } from './model-command/modelCommandEffort'
import type { ModelCommandContext } from './model-command/modelCommandTarget'
import { context, member } from './model-command/testing/modelCommandFixture'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())
beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

/** The composer's command engine fed `/effort`'s steps, the way `useModelCommand` feeds it. */
async function mount(ctx: ModelCommandContext) {
  const { act, useState } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useComposerCommands } = await import('./useComposerCommands')
  const load = async (_c: unknown, arg: string, query: string, committed: Record<string, string>) =>
    effortStepOptions(ctx, arg, query, committed)
  const skip = (_c: unknown, name: string, committed: ReadonlyMap<string, string>) =>
    skipEffortStep(ctx, name, committed)
  const state = { composer: null as unknown as ComposerCommands, prompt: '' }
  function Harness() {
    const [value, setValue] = useState('/effort ')
    state.prompt = value
    state.composer = useComposerCommands(value, setValue, [], load as never, skip as never)
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<Harness />))
  const settle = () =>
    act(async () => {
      jest.advanceTimersByTime(250)
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })
  const press = (key: string) =>
    act(async () => void state.composer.handleKeyDown({ key, preventDefault() {} } as never))
  const labels = () => state.composer.slashArgs.options.map((row) => row.value)
  const step = () => state.composer.slashArgs.activeSpec?.name
  await settle()
  return { state, settle, press, labels, step, unmount: () => act(async () => root.unmount()) }
}

test('/effort in a one-agent chat opens on the reasoning levels of the model it runs', async () => {
  const ui = await mount(context([member('solo', 'openai/gpt', 'high')]))
  try {
    expect(ui.step()).toBe('reasoning')
    expect(ui.labels()).toEqual(['off', 'minimal', 'low', 'medium', 'high'])
    await ui.press('Enter')
    // The first level is picked as a crumb; /model's provider and model steps never show.
    expect(ui.state.prompt).toBe('/effort off ')
    expect(ui.step()).toBeUndefined()
  } finally {
    await ui.unmount()
  }
})

test('/effort in a group asks for the agent first, then that agent’s levels', async () => {
  const ui = await mount(
    context([member('lead', 'openai/gpt', 'high'), member('qa', 'anthropic/opus', 'medium')]),
  )
  try {
    expect(ui.step()).toBe('agent')
    expect(ui.labels()).toEqual(['@lead', '@qa'])
    await ui.press('ArrowDown')
    await ui.press('Enter')
    expect(ui.state.prompt).toBe('/effort @qa ')
    await ui.settle()
    expect(ui.step()).toBe('reasoning')
    expect(ui.labels()).toEqual(['low', 'medium', 'high', 'max'])
  } finally {
    await ui.unmount()
  }
})

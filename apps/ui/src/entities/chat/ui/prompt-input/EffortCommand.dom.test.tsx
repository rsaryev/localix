import { afterAll, afterEach, beforeAll, beforeEach, expect, jest, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ComposerCommands } from './useComposerCommands'
import { effortStepOptions, skipEffortStep } from './model-command/modelCommandEffort'
import type { ModelCommandContext } from './model-command/modelCommandTarget'
import { agentRow, context } from './model-command/testing/modelCommandFixture'

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
  const { act, useEffect, useState } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useComposerCommands } = await import('./useComposerCommands')
  const load = async (_c: unknown, arg: string, query: string) => effortStepOptions(ctx, arg, query)
  const skip = (_c: unknown, name: string) => skipEffortStep(ctx, name)
  const state = { composer: null as unknown as ComposerCommands, prompt: '' }
  function Harness() {
    const [value, setValue] = useState('/effort ')
    const composer = useComposerCommands(value, setValue, [], load as never, skip as never)
    useEffect(() => {
      state.prompt = value
      state.composer = composer
    })
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
  const ui = await mount(context(agentRow('solo', 'openai/gpt', 'high')))
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

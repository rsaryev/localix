import { describe, expect, test } from 'bun:test'
import {
  callTool,
  fakeSemantic,
  requestRoute,
  testMiniAppContext,
} from '@localixai/mini-app-sdk/backend/testing'
import { register } from './index'

describe('Daily Log', () => {
  test('what the agent logs is on the screen, and what the screen adds the agent sees', async () => {
    await using ctx = await testMiniAppContext({ name: 'template' })
    const app = register(ctx)

    const logged = await callTool(app, 'template_log_entry', {
      title: 'Oatmeal',
      amount: 320,
      category: 'Breakfast',
    })
    expect(logged).toEqual({
      text: expect.stringContaining('Logged Oatmeal: 320 kcal.'),
      isError: false,
    })
    expect(logged.text).toContain('Today: 320 of 2000 kcal (16%)')

    const screen = await requestRoute(app, 'POST', '/entries', { title: 'Apple', amount: 80 })
    expect(screen.json).toEqual({
      items: [
        expect.objectContaining({ title: 'Oatmeal', category: 'Breakfast' }),
        expect.objectContaining({ title: 'Apple', category: 'General' }),
      ],
    })
    const summary = await callTool(app, 'template_summary', {})
    expect(summary.text).toContain('Today: 400 of 2000 kcal (20%), 1600 kcal left.')
    expect(summary.text).toContain('- Apple: 80 kcal, General')
  })

  test('the agent is shown the limits the log keeps, so a call it makes is one the log accepts', async () => {
    await using ctx = await testMiniAppContext({ name: 'template' })
    const tool = register(ctx).tools?.find((t) => t.name === 'template_log_entry')
    const accepts = (input: unknown) => tool?.inputSchema?.safeParse(input).success

    expect(accepts({ title: 'Oatmeal', amount: 320 })).toBe(true)
    expect(accepts({ title: 'x'.repeat(121), amount: 320 })).toBe(false)
    expect(accepts({ title: '   ', amount: 320 })).toBe(false)
  })

  test('the agent removes an entry by the id it was shown, and is told when it is gone', async () => {
    await using ctx = await testMiniAppContext({ name: 'template' })
    const app = register(ctx)
    await requestRoute(app, 'POST', '/entries', { title: 'Cake', amount: 450 })
    const [cake] = (
      (await requestRoute(app, 'GET', '/entries')).json as { items: { id: string }[] }
    ).items

    expect((await callTool(app, 'template_remove_entry', { id: cake!.id })).text).toContain(
      'Removed it.',
    )
    expect(await callTool(app, 'template_remove_entry', { id: cake!.id })).toEqual({
      text: expect.stringContaining('No entry has that id'),
      isError: true,
    })
  })

  test('the goal and the unit come from the app’s settings, for the screen and the agent', async () => {
    await using ctx = await testMiniAppContext({
      name: 'template',
      config: { DAILY_GOAL: '10000', UNIT: 'steps' },
    })
    const app = register(ctx)

    expect((await requestRoute(app, 'GET', '/settings')).json).toEqual({
      dailyGoal: 10000,
      unit: 'steps',
    })
    expect((await callTool(app, 'template_summary', {})).text).toContain('Today: 0 of 10000 steps')
  })

  test('the agent finds past entries by meaning, and is told when search is not ready', async () => {
    const semantic = fakeSemantic()
    await using ctx = await testMiniAppContext({ name: 'template', host: { semantic } })
    const app = register(ctx)
    await callTool(app, 'template_log_entry', { title: 'Tomato soup', amount: 180 })
    await callTool(app, 'template_log_entry', { title: 'Toast', amount: 200 })

    expect((await callTool(app, 'template_find_entries', { query: 'soup' })).text).toContain(
      'No entries match',
    )
    semantic.ready = true
    const found = await callTool(app, 'template_find_entries', { query: 'soup' })
    expect(found.text).toContain('Tomato soup, 180 kcal')
    expect(found.text).not.toContain('Toast')
  })
})

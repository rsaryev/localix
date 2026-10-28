import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'

import { createMiniAppGuideTool, MINI_APP_GUIDE_MAX_CHARS } from './mini-app-guide'

const dir = tempDirPerTest('mini-app-guide-')

const run = async (tool: ReturnType<typeof createMiniAppGuideTool>, input: unknown) => {
  const result = await tool.execute('call', input as { app: string })
  return {
    text: result.content as string,
    isError: (result as { isError?: boolean }).isError === true,
  }
}

describe('MiniAppGuide', () => {
  test('hands the agent the guide of an enabled mini app', async () => {
    writeTree(dir(), { 'tiles/guide.md': 'Play with the `tiles` tool.\n' })
    const tool = createMiniAppGuideTool([{ app: 'tiles', file: join(dir(), 'tiles/guide.md') }])
    expect(await run(tool, { app: 'tiles' })).toEqual({
      text: 'Play with the `tiles` tool.\n',
      isError: false,
    })
  })

  test('an app it does not know is an error that names the ones it does', async () => {
    const tool = createMiniAppGuideTool([
      { app: 'tiles', file: join(dir(), 'tiles/guide.md') },
      { app: 'notes', file: join(dir(), 'notes/guide.md') },
    ])
    const result = await run(tool, { app: 'tles' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('tles')
    expect(result.text).toContain('tiles, notes')
  })

  test('a guide the app does not ship says so instead of failing the call', async () => {
    const tool = createMiniAppGuideTool([{ app: 'tiles', file: join(dir(), 'missing.md') }])
    const result = await run(tool, { app: 'tiles' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('tiles')
  })

  test('a guide longer than the cap is cut, and says it was', async () => {
    writeTree(dir(), { 'long/guide.md': 'x'.repeat(MINI_APP_GUIDE_MAX_CHARS + 100) })
    const tool = createMiniAppGuideTool([{ app: 'long', file: join(dir(), 'long/guide.md') }])
    const result = await run(tool, { app: 'long' })
    expect(result.isError).toBe(false)
    expect(result.text.length).toBeLessThan(MINI_APP_GUIDE_MAX_CHARS + 200)
    expect(result.text).toContain('cut')
  })

  test('a page of the guide comes from its guide/ folder, and nothing outside it', async () => {
    writeTree(dir(), {
      'charts/guide.md': 'See the recipes page.\n',
      'charts/guide/recipes.md': 'Recipe one.\n',
      'charts/secret.md': 'Not a guide page.\n',
    })
    const tool = createMiniAppGuideTool([
      { app: 'charts', file: join(dir(), 'charts/guide.md'), pages: join(dir(), 'charts/guide') },
    ])
    expect(await run(tool, { app: 'charts', page: 'recipes' })).toEqual({
      text: 'Recipe one.\n',
      isError: false,
    })
    for (const page of ['../secret', '../../charts/secret', 'missing']) {
      const result = await run(tool, { app: 'charts', page })
      expect(result.isError, page).toBe(true)
      expect(result.text).not.toContain('Not a guide page')
    }
  })

  test('reading a guide changes nothing', () => {
    const tool = createMiniAppGuideTool([])
    expect(tool.mutates).toBe(false)
    expect(tool.classify?.({ app: 'tiles' })).toEqual({ effect: 'read' })
  })
})

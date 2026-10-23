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

describe('mini_app_guide', () => {
  test('hands the agent the guide of an enabled mini app', async () => {
    writeTree(dir(), { 'chess/guide.md': 'Play with the `chess` tool.\n' })
    const tool = createMiniAppGuideTool([{ app: 'chess', file: join(dir(), 'chess/guide.md') }])
    expect(await run(tool, { app: 'chess' })).toEqual({
      text: 'Play with the `chess` tool.\n',
      isError: false,
    })
  })

  test('an app it does not know is an error that names the ones it does', async () => {
    const tool = createMiniAppGuideTool([
      { app: 'chess', file: join(dir(), 'chess/guide.md') },
      { app: 'kanban', file: join(dir(), 'kanban/guide.md') },
    ])
    const result = await run(tool, { app: 'chss' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('chss')
    expect(result.text).toContain('chess, kanban')
  })

  test('a guide the app does not ship says so instead of failing the call', async () => {
    const tool = createMiniAppGuideTool([{ app: 'chess', file: join(dir(), 'missing.md') }])
    const result = await run(tool, { app: 'chess' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('chess')
  })

  test('a guide longer than the cap is cut, and says it was', async () => {
    writeTree(dir(), { 'long/guide.md': 'x'.repeat(MINI_APP_GUIDE_MAX_CHARS + 100) })
    const tool = createMiniAppGuideTool([{ app: 'long', file: join(dir(), 'long/guide.md') }])
    const result = await run(tool, { app: 'long' })
    expect(result.isError).toBe(false)
    expect(result.text.length).toBeLessThan(MINI_APP_GUIDE_MAX_CHARS + 200)
    expect(result.text).toContain('cut')
  })

  test('reading a guide changes nothing', () => {
    const tool = createMiniAppGuideTool([])
    expect(tool.mutates).toBe(false)
    expect(tool.classify?.({ app: 'chess' })).toEqual({ effect: 'read' })
  })
})

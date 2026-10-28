import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { fakeKit } from '../testing/fake-kit'
import { tempDirPerTest, writeTree } from '../testing/temp'
import { miniAppRootOf, postEdit } from './post-edit'

const tempDir = tempDirPerTest('mini-app-hook-')

function app() {
  const dir = tempDir()
  writeTree(dir, {
    'mini-app.json': '{"name":"gpu-monitor"}',
    'ui/Workspace.tsx': 'export const Workspace = () => <button onClick={go}>Go</button>\n',
    'ui/Clean.tsx': 'export const Clean = () => null\n',
    'backend/routes.ts': "app.post('/x', async (c) => { const body = await c.req.json() })\n",
  })
  return dir
}

/** A kit folder with the host stylesheet the style gate reads its tokens from. */
function kitOnDisk() {
  const dir = tempDir()
  writeTree(dir, { 'ui/styles/index.css': ':root { --color-text: #000; }' })
  const style = {
    ...fakeKit().tools.style,
    themeTokensOf: () => ({ colors: new Set(['text']), radii: new Set(['md']) }),
  }
  return async () => fakeKit({ dir, tools: { style } })
}

const edit = (file_path: string) =>
  JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path } })

describe('the post-edit hook', () => {
  test('tells the agent what the file it just wrote breaks, with file and line', async () => {
    const dir = app()
    const output = await postEdit(edit(join(dir, 'ui/Workspace.tsx')), kitOnDisk())
    const context = JSON.parse(output!).hookSpecificOutput
    expect(context.hookEventName).toBe('PostToolUse')
    expect(context.additionalContext).toContain('ui/Workspace.tsx:1')
    expect(context.additionalContext).toContain('kit control')
    expect(context.additionalContext).not.toContain('routes.ts')
  })

  test('route bodies are judged by the kit’s rule', async () => {
    const dir = app()
    const output = await postEdit(edit(join(dir, 'backend/routes.ts')), kitOnDisk())
    expect(JSON.parse(output!).hookSpecificOutput.additionalContext).toContain('unvalidated body')
  })

  test('says nothing about a clean file, a file outside a mini app, or built output', async () => {
    const dir = app()
    writeTree(dir, { 'dist/package/ui/Workspace.tsx': '<button/>' })
    const kit = kitOnDisk()
    expect(await postEdit(edit(join(dir, 'ui/Clean.tsx')), kit)).toBeNull()
    expect(await postEdit(edit(join(tempDir(), 'x.tsx')), kit)).toBeNull()
    expect(await postEdit(edit(join(dir, 'dist/package/ui/Workspace.tsx')), kit)).toBeNull()
    expect(await postEdit('not json', kit)).toBeNull()
  })

  test('without a kit on this computer it stays quiet rather than block the edit', async () => {
    const dir = app()
    const output = await postEdit(edit(join(dir, 'ui/Workspace.tsx')), async () => {
      throw new Error('no kit')
    })
    expect(output).toBeNull()
  })
})

test('a file’s mini app is the nearest folder with a mini-app.json', () => {
  const dir = app()
  expect(miniAppRootOf(join(dir, 'ui/Workspace.tsx'))).toBe(dir)
  expect(miniAppRootOf(join(dir, 'node_modules/x/index.ts'))).toBeNull()
})

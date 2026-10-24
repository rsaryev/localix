import { expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { resolveRunOutputStyle } from './output-style'

/** `outputStyle` in Claude Code's settings is the style a chat speaks in when nothing else is set. */
const root = tempDirPerTest('cc-output-style-')

test("Claude Code's outputStyle applies when neither the chat nor Localix chose one", async () => {
  writeTree(root(), {
    'home/.claude/settings.json': JSON.stringify({ outputStyle: 'Explanatory' }),
    'project/.keep': '',
  })
  const base = { pluginStyles: [], cwd: join(root(), 'project'), homeDir: join(root(), 'home') }
  expect((await resolveRunOutputStyle({ ...base, chosen: null }))?.fullName).toBe('Explanatory')
  expect(
    (await resolveRunOutputStyle({ ...base, chosen: null, defaultStyle: 'Concise' }))?.fullName,
  ).toBe('Concise')
  expect(await resolveRunOutputStyle({ ...base, chosen: 'default' })).toBeNull()
})

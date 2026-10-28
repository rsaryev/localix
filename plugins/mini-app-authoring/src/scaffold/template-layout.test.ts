import { expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '../testing/temp'
import { findTemplateResidue, type TemplateScaffold } from './template-layout'

const tempDir = tempDirPerTest('template-layout-')

const scaffold: TemplateScaffold = {
  summary: 'Daily Log reference mini app',
  domainName: 'Daily Log',
  entry: ['mini-app.json', 'icon.svg'],
  domain: ['backend/entries.ts'],
  patterns: [],
  authoringOnly: [],
  replaceMedia: ['icon.svg'],
  domainNamedPaths: ['entr'],
  domainTokens: ['entriesSpec', '{snake}_log_entry'],
  renames: [],
  directoryRenames: [],
  tools: ['{snake}_log_entry', '{snake}_summary'],
}

const ICON = '<svg viewBox="0 0 1024 1024"><path d="M1 1"/></svg>\n'

/** The template beside a copy of it named `meal-log`, the copy's files laid over the template's. */
function templateAndCopy(copy: Record<string, string>) {
  const root = tempDir()
  const template = join(root, 'template')
  const app = join(root, 'meal-log')
  writeTree(template, { 'icon.svg': ICON })
  writeTree(app, {
    'mini-app.json': '{"name":"meal-log"}',
    'icon.svg': ICON,
    'backend/index.test.ts': "test('logs', () => {})\n",
    ...copy,
  })
  return { template, app }
}

test('names a domain identifier the copy kept, its placeholders filled for the copy', () => {
  const { template, app } = templateAndCopy({
    'backend/tools.ts': "ctx.defineTool({ name: 'meal_log_log_entry' })\n",
  })
  expect(findTemplateResidue(app, 'meal-log', scaffold, template)).toContain(
    'backend/tools.ts still names the template domain (`meal_log_log_entry`)',
  )
})

test('a tool the copy may keep by its job, like the summary, is not residue', () => {
  const { template, app } = templateAndCopy({
    'backend/tools.ts': "ctx.defineTool({ name: 'meal_log_summary' })\n",
  })
  expect(findTemplateResidue(app, 'meal-log', scaffold, template)).not.toContainEqual(
    expect.stringContaining('meal_log_summary'),
  )
})

test("reports the template's own icon, kept unchanged, and passes a drawn one", () => {
  const kept = templateAndCopy({})
  expect(findTemplateResidue(kept.app, 'meal-log', scaffold, kept.template)).toContain(
    "icon.svg is still the Daily Log icon — draw this app's own with mini-app icon --glyph",
  )
  const drawn = templateAndCopy({ 'icon.svg': ICON.replace('M1 1', 'M2 2') })
  expect(findTemplateResidue(drawn.app, 'meal-log', scaffold, drawn.template)).toEqual([])
})

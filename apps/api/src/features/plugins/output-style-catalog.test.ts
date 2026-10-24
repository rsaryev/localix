import { describe, expect, test } from 'bun:test'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { readLocalOutputStyles } from './output-style-files'
import { activeOutputStyle, outputStyleCatalog, type PluginOutputStyle } from './output-styles'

const home = tempDirPerTest('styles-home-')
const repo = tempDirPerTest('styles-repo-')

const pluginStyle = (name: string, forceForPlugin = false): PluginOutputStyle => ({
  pluginName: 'p',
  fullName: `p:${name}`,
  source: 'plugin',
  style: { name, description: '', keepCodingInstructions: true, forceForPlugin, prompt: name },
})

describe('the output style catalog', () => {
  test('starts with the four built-in styles, each keeping the coding instructions', () => {
    const builtins = outputStyleCatalog({})
    expect(builtins.map((entry) => entry.fullName)).toEqual([
      'Proactive',
      'Concise',
      'Explanatory',
      'Learning',
    ])
    expect(builtins.every((entry) => entry.style.keepCodingInstructions)).toBe(true)
    expect(builtins.find((entry) => entry.fullName === 'Explanatory')?.style.prompt).toContain(
      '★ Insight',
    )
    expect(builtins.find((entry) => entry.fullName === 'Learning')?.style.prompt).toContain(
      'TODO(human)',
    )
  })

  test('a local style of the same name replaces a built-in, the project over the person', () => {
    const style = (prompt: string) => ({
      name: 'Concise',
      description: '',
      keepCodingInstructions: false,
      forceForPlugin: false,
      prompt,
    })
    const catalog = outputStyleCatalog({ user: [style('mine')], project: [style('team')] })
    const concise = catalog.filter((entry) => entry.fullName === 'Concise')
    expect(concise).toHaveLength(1)
    expect(concise[0]).toMatchObject({ source: 'project', style: { prompt: 'team' } })
  })
})

describe('choosing the style a chat runs in', () => {
  const catalog = outputStyleCatalog({ plugins: [pluginStyle('terse')] })

  test("a chat's own choice wins over the person's default", () => {
    expect(activeOutputStyle(catalog, 'p:terse', 'Concise')?.fullName).toBe('p:terse')
  })

  test("a chat that made no choice follows the person's default, matched exactly", () => {
    expect(activeOutputStyle(catalog, null, 'Explanatory')?.fullName).toBe('Explanatory')
    expect(activeOutputStyle(catalog, null, 'explanatory')).toBeNull()
  })

  test("`default` chosen in the chat overrides the person's default", () => {
    expect(activeOutputStyle(catalog, 'default', 'Explanatory')).toBeNull()
  })

  test('a forced plugin style wins over both', () => {
    const forced = outputStyleCatalog({ plugins: [pluginStyle('house', true)] })
    expect(activeOutputStyle(forced, 'Concise', 'Learning')?.fullName).toBe('p:house')
  })
})

describe("reading the person's and the project's styles", () => {
  test('reads `.localix/output-styles` from home and from the working directory up to the repository root', async () => {
    writeTree(home(), { '.localix/output-styles/plain.md': '---\nname: Plain\n---\nNo frills.' })
    writeTree(repo(), {
      '.git/HEAD': 'ref: refs/heads/main\n',
      '.localix/output-styles/team.md': 'Root team voice.',
      '.localix/output-styles/root-only.md': 'Only at the root.',
      'packages/app/.localix/output-styles/team.md': 'Nearest team voice.',
    })
    const local = await readLocalOutputStyles({
      homeDir: home(),
      cwd: `${repo()}/packages/app`,
    })
    expect(local.user).toEqual([
      {
        name: 'Plain',
        description: '',
        keepCodingInstructions: false,
        forceForPlugin: false,
        prompt: 'No frills.',
      },
    ])
    expect(Object.fromEntries(local.project.map((style) => [style.name, style.prompt]))).toEqual({
      team: 'Nearest team voice.',
      'root-only': 'Only at the root.',
    })
  })

  test('outside a repository only the working directory is read', async () => {
    writeTree(repo(), {
      '.localix/output-styles/above.md': 'Above.',
      'sub/.localix/output-styles/here.md': 'Here.',
    })
    const local = await readLocalOutputStyles({ homeDir: home(), cwd: `${repo()}/sub` })
    expect(local.project.map((style) => style.name)).toEqual(['here'])
  })

  test("Claude Code's `.claude/output-styles` load too; Localix's own folder wins a name", async () => {
    writeTree(home(), {
      '.claude/output-styles/terse.md': 'From Claude Code.',
      '.claude/output-styles/plain.md': 'Claude Code plain.',
      '.localix/output-styles/plain.md': 'Localix plain.',
    })
    writeTree(repo(), {
      '.git/HEAD': 'ref: refs/heads/main\n',
      '.claude/output-styles/review.md': 'Team review voice.',
    })
    const local = await readLocalOutputStyles({ homeDir: home(), cwd: repo(), env: {} })
    expect(Object.fromEntries(local.user.map((style) => [style.name, style.prompt]))).toEqual({
      terse: 'From Claude Code.',
      plain: 'Localix plain.',
    })
    expect(local.project.map((style) => style.name)).toEqual(['review'])
  })
})

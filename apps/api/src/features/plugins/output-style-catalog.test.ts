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
  style: {
    id: `p:${name}`,
    name,
    description: '',
    keepCodingInstructions: true,
    forceForPlugin,
    instructions: name,
  },
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
    expect(
      builtins.find((entry) => entry.fullName === 'Explanatory')?.style.instructions,
    ).toContain('★ Insight')
    expect(builtins.find((entry) => entry.fullName === 'Learning')?.style.instructions).toContain(
      'TODO(human)',
    )
  })

  // output-styles.md, "Change your output style"; the kit's `listOutputStyles`: a custom style
  // never shadows a built-in, and of two that share a name the first in precedence order wins.
  test('a local style never replaces a built-in; the project wins a name over the person', () => {
    const style = (name: string, instructions: string) => ({
      id: name,
      name,
      description: '',
      keepCodingInstructions: false,
      forceForPlugin: false,
      instructions,
    })
    const catalog = outputStyleCatalog({
      user: [style('Concise', 'mine'), style('shared', 'mine')],
      project: [style('Concise', 'team'), style('shared', 'team')],
    })
    const concise = catalog.filter((entry) => entry.fullName === 'Concise')
    expect(concise).toEqual([expect.objectContaining({ source: 'builtin' })])
    expect(catalog.filter((entry) => entry.fullName === 'shared')).toEqual([
      expect.objectContaining({
        source: 'project',
        style: expect.objectContaining({ instructions: 'team' }),
      }),
    ])
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

/** What the catalog offers of the local styles, by source: the kit picks the first of a name. */
const offered = (
  local: Awaited<ReturnType<typeof readLocalOutputStyles>>,
  source: 'user' | 'project',
) =>
  Object.fromEntries(
    outputStyleCatalog(local)
      .filter((entry) => entry.source === source)
      .map((entry) => [entry.style.name, entry.style.instructions]),
  )

describe("reading the person's and the project's styles", () => {
  test('reads `.localix/output-styles` from home and from the working directory up', async () => {
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
      env: {},
    })
    expect(local.user).toEqual([
      {
        id: 'Plain',
        name: 'Plain',
        keepCodingInstructions: false,
        forceForPlugin: false,
        instructions: 'No frills.',
      },
    ])
    expect(offered(local, 'project')).toEqual({
      team: 'Nearest team voice.',
      'root-only': 'Only at the root.',
    })
  })

  // The kit's folders (`settingsLocations`): the working directory and its parents, with or without
  // a repository, the nearest winning a name.
  test('outside a repository the parents are read too, the nearest winning', async () => {
    writeTree(repo(), {
      '.claude/output-styles/above.md': 'Above.',
      '.claude/output-styles/here.md': 'Far.',
      'sub/.localix/output-styles/here.md': 'Here.',
    })
    const local = await readLocalOutputStyles({ homeDir: home(), cwd: `${repo()}/sub`, env: {} })
    expect(offered(local, 'project')).toEqual({ here: 'Here.', above: 'Above.' })
  })

  test("`CLAUDE_CONFIG_DIR` is the person's Claude Code folder, taken as written", async () => {
    writeTree(home(), { 'work/output-styles/terse.md': 'From work.' })
    const local = await readLocalOutputStyles({
      homeDir: home(),
      env: { CLAUDE_CONFIG_DIR: `${home()}/work` },
    })
    expect(local.user.map((style) => style.instructions)).toEqual(['From work.'])
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
    expect(offered(local, 'user')).toEqual({ terse: 'From Claude Code.', plain: 'Localix plain.' })
    expect(local.project.map((style) => style.name)).toEqual(['review'])
  })
})

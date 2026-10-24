import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { discoverContextFiles } from './context-files'

// memory.md — where Claude Code reads instructions from, and how. A repository set up for Claude
// Code has to give the agent the same instructions in Localix.
describe('Claude Code instruction files', () => {
  const base = tempDirPerTest('ctx-claude-')
  const setup = async () => {
    const home = join(base(), 'home')
    const outer = join(base(), 'outer')
    const root = join(outer, 'repo')
    await fs.mkdir(join(root, '.git'), { recursive: true })
    await fs.mkdir(home, { recursive: true })
    return { home, outer, root }
  }
  const write = async (path: string, text: string) => {
    await fs.mkdir(join(path, '..'), { recursive: true })
    await fs.writeFile(path, text)
  }

  test('~/.claude/CLAUDE.md and ~/.claude/rules load before the project', async () => {
    const { home, root } = await setup()
    await write(join(home, '.claude', 'CLAUDE.md'), 'user memory')
    await write(join(home, '.claude', 'rules', 'prefs.md'), 'user rule')
    await write(join(root, 'CLAUDE.md'), 'project memory')
    const files = await discoverContextFiles(root, { homeDir: home })
    expect(files.map((f) => f.content)).toEqual(['user memory', 'user rule', 'project memory'])
  })

  test('.claude/rules load, a path-scoped one against the folder that holds its .claude', async () => {
    const { home, root } = await setup()
    const pkg = join(root, 'packages', 'web')
    await write(join(root, '.claude', 'rules', 'style.md'), 'always rule')
    await write(
      join(pkg, '.claude', 'rules', 'tsx.md'),
      '---\npaths: src/*.tsx, lib/*.ts\n---\ntsx rule',
    )
    await write(join(pkg, 'src', 'App.tsx'), 'x')
    const files = await discoverContextFiles(pkg, { homeDir: home })
    expect(files.map((f) => f.content)).toEqual(['always rule', 'tsx rule'])
  })

  test('a symlinked rule inside the project loads', async () => {
    const { home, root } = await setup()
    await write(join(root, 'shared', 'security.md'), 'linked rule')
    await fs.mkdir(join(root, '.claude', 'rules'), { recursive: true })
    await fs.symlink(
      join(root, 'shared', 'security.md'),
      join(root, '.claude', 'rules', 'security.md'),
    )
    const files = await discoverContextFiles(root, { homeDir: home })
    expect(files.map((f) => f.content)).toEqual(['linked rule'])
  })

  test('a CLAUDE.md above the repository loads first', async () => {
    const { home, outer, root } = await setup()
    await write(join(outer, 'CLAUDE.md'), 'outer memory')
    await write(join(root, 'CLAUDE.md'), 'repo memory')
    const files = await discoverContextFiles(root, { homeDir: home })
    expect(files.map((f) => f.content)).toEqual(['outer memory', 'repo memory'])
  })

  test('block-level HTML comments are stripped, those in code blocks kept', async () => {
    const { home, root } = await setup()
    await write(
      join(root, 'CLAUDE.md'),
      [
        '<!-- maintainer note -->',
        'Keep this.',
        '<!--',
        'multi',
        '-->',
        '```',
        '<!-- code -->',
        '```',
      ].join('\n'),
    )
    const [file] = await discoverContextFiles(root, { homeDir: home })
    expect(file!.content).toContain('Keep this.')
    expect(file!.content).toContain('<!-- code -->')
    expect(file!.content).not.toContain('maintainer note')
    expect(file!.content).not.toContain('multi')
  })

  test('an import with backslash-escaped spaces loads the file', async () => {
    const { home, root } = await setup()
    await write(join(root, 'Design Docs', 'api.md'), 'api conventions')
    await write(join(root, 'CLAUDE.md'), '- API conventions @Design\\ Docs/api.md')
    const [file] = await discoverContextFiles(root, { homeDir: home })
    expect(file!.content).toContain('api conventions')
  })
})

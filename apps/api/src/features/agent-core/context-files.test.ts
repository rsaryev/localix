import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { discoverTouchedContextFiles } from './context-on-demand'
import {
  discoverContextFiles,
  buildProjectContextSection,
  MAX_CHARS_PER_FILE,
} from './context-files'

let root: string
let home: string

// Isolate every test from the real ~/.localix/context.md by pointing homeDir at
// an empty temp dir. Tests that exercise user-global loading populate it explicitly.
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'ctxfiles-'))
  home = await fs.mkdtemp(join(tmpdir(), 'ctxhome-'))
  // Make the temp root a git root so the walk never escapes into the real fs.
  await fs.mkdir(join(root, '.git'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(home, { recursive: true, force: true })
})

const discover = (cwd: string) => discoverContextFiles(cwd, { homeDir: home })
const writeContext = async (base: string, content: string): Promise<void> => {
  const dir = join(base, '.localix')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(join(dir, 'context.md'), content)
}

describe('discoverContextFiles', () => {
  test('returns [] for missing/empty cwd and dirs without context files', async () => {
    expect(await discoverContextFiles(null, { homeDir: home })).toEqual([])
    expect(await discoverContextFiles('/', { homeDir: home })).toEqual([])
    expect(await discover(root)).toEqual([])
    expect(await discover(join(root, 'does-not-exist'))).toEqual([])
  })

  // memory.md, "Choose which instruction files load" (`claude-md-and-agents-md`): each
  // directory's CLAUDE.md files first, its AGENTS.md after them.
  test('loads CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md, then AGENTS.md and native context', async () => {
    await fs.writeFile(join(root, 'AGENTS.md'), 'agents instructions')
    await fs.writeFile(join(root, 'CLAUDE.md'), 'claude instructions')
    await fs.writeFile(join(root, 'CLAUDE.local.md'), 'local instructions')
    await fs.writeFile(join(root, '.cursorrules'), 'cursor')
    await fs.mkdir(join(root, '.claude'))
    await fs.writeFile(join(root, '.claude', 'CLAUDE.md'), 'dot-claude instructions')
    await writeContext(root, 'localix instructions')
    const files = await discover(root)
    expect(files.map((file) => file.path)).toEqual([
      join(root, 'CLAUDE.md'),
      join(root, '.claude', 'CLAUDE.md'),
      join(root, 'CLAUDE.local.md'),
      join(root, 'AGENTS.md'),
      join(root, '.localix', 'context.md'),
    ])
  })

  test('a CLAUDE.md that imports AGENTS.md does not read it twice', async () => {
    const leaf = join(root, 'services', 'api')
    await fs.mkdir(leaf, { recursive: true })
    await fs.writeFile(join(root, 'CLAUDE.md'), '@AGENTS.md\n\nScreenshot rules.')
    await fs.writeFile(join(root, 'AGENTS.md'), 'workspace contract')
    await fs.writeFile(join(leaf, 'AGENTS.md'), 'service contract')
    const files = await discover(leaf)
    expect(files.map((file) => file.path)).toEqual([
      join(root, 'CLAUDE.md'),
      join(leaf, 'AGENTS.md'),
    ])
    expect(files[0].content).toContain('workspace contract')
    expect(files[0].content).toContain('Screenshot rules.')
  })

  test('keeps AGENTS.md directory scope in root-to-leaf order', async () => {
    const leaf = join(root, 'apps', 'landing')
    await fs.mkdir(leaf, { recursive: true })
    await fs.writeFile(join(root, 'AGENTS.md'), 'root contract')
    await fs.writeFile(join(leaf, 'AGENTS.md'), 'landing contract')
    await writeContext(leaf, 'native landing contract')
    expect((await discover(leaf)).map((file) => file.content)).toEqual([
      'root contract',
      'landing contract',
      'native landing contract',
    ])
  })

  test('does not admit AGENTS.md through a symlink outside the checkout', async () => {
    await fs.writeFile(join(home, 'AGENTS.md'), 'outside contract')
    await fs.symlink(join(home, 'AGENTS.md'), join(root, 'AGENTS.md'))
    await writeContext(root, 'native contract')
    expect((await discover(root)).map((file) => file.content)).toEqual(['native contract'])
  })

  test('walks the hierarchy ROOT-first (broadest → nearest)', async () => {
    const mid = join(root, 'packages')
    const leaf = join(mid, 'app')
    await fs.mkdir(leaf, { recursive: true })
    await writeContext(root, 'root rules')
    await writeContext(leaf, 'leaf rules')

    const files = await discover(leaf)
    expect(files.map((f) => f.content)).toEqual(['root rules', 'leaf rules'])
  })

  test('user-global ~/.localix/context.md loads first, before project files', async () => {
    await writeContext(home, 'global prefs')
    await writeContext(root, 'project rules')
    const files = await discover(root)
    expect(files.map((f) => f.content)).toEqual(['global prefs', 'project rules'])
  })

  test('the project walk does not re-read the global Localix context as project context', async () => {
    const proj = join(home, 'proj')
    await fs.mkdir(proj)
    await fs.mkdir(join(proj, '.git'))
    await writeContext(home, 'global file')
    await writeContext(proj, 'project file')
    const files = await discover(proj)
    expect(files.map((f) => f.content)).toEqual(['global file', 'project file'])
  })

  test('stops at the git root (does not collect above it)', async () => {
    const inner = join(root, 'repo')
    await fs.mkdir(inner)
    await fs.mkdir(join(inner, '.git'))
    await writeContext(root, 'outer rules')

    const files = await discover(inner)
    expect(files).toEqual([])
  })

  test('caps each file at 20,000 chars with a truncation marker', async () => {
    await writeContext(root, 'y'.repeat(30_000))
    const files = await discover(root)
    expect(files).toHaveLength(1)
    expect(files[0].content.length).toBeLessThan(MAX_CHARS_PER_FILE + 200)
    expect(files[0].content).toContain('truncated')
  })
})

describe('.localix/rules', () => {
  test('loads rule files recursively, alphabetically', async () => {
    const rules = join(root, '.localix', 'rules')
    await fs.mkdir(join(rules, 'backend'), { recursive: true })
    await fs.writeFile(join(rules, 'testing.md'), 'rule: testing')
    await fs.writeFile(join(rules, 'backend', 'api.md'), 'rule: api')
    const files = await discover(root)
    // Sorted by path relative to rulesDir: 'backend/api.md' < 'testing.md'.
    expect(files.map((f) => f.content)).toEqual(['rule: api', 'rule: testing'])
  })

  // memory.md, "Path-specific rules": a path-scoped rule loads "when Claude uses the Read, Write,
  // or Edit tool on a matching file" — not because such a file exists somewhere in the project.
  test('a path-scoped rule waits for a matching file to be worked with', async () => {
    await fs.mkdir(join(root, 'src'), { recursive: true })
    await fs.writeFile(join(root, 'src', 'index.ts'), 'code')
    const rules = join(root, '.localix', 'rules')
    await fs.mkdir(rules, { recursive: true })
    await fs.writeFile(join(rules, 'ts.md'), '---\npaths:\n  - "src/**/*.ts"\n---\nTS rule body')
    const stable = await discover(root)
    expect(stable).toEqual([])
    const touched = await discoverTouchedContextFiles(
      root,
      [join(root, 'src', 'index.ts')],
      stable,
      {
        homeDir: home,
      },
    )
    expect(touched.map((f) => f.content)).toEqual(['TS rule body'])
    expect(
      await discoverTouchedContextFiles(root, [join(root, 'README.md')], stable, { homeDir: home }),
    ).toEqual([])
  })

  test('path-scoped rule is excluded when nothing in the project matches', async () => {
    const rules = join(root, '.localix', 'rules')
    await fs.mkdir(rules, { recursive: true })
    await fs.writeFile(join(rules, 'go.md'), '---\npaths: ["**/*.go"]\n---\nGo rule body')
    const files = await discover(root)
    expect(files).toEqual([])
  })

  test('user-level ~/.localix/rules load before project rules', async () => {
    await fs.mkdir(join(home, '.localix', 'rules'), { recursive: true })
    await fs.writeFile(join(home, '.localix', 'rules', 'style.md'), 'user style rule')
    await fs.mkdir(join(root, '.localix', 'rules'), { recursive: true })
    await fs.writeFile(join(root, '.localix', 'rules', 'proj.md'), 'project rule')
    const files = await discover(root)
    expect(files.map((f) => f.content)).toEqual(['user style rule', 'project rule'])
  })
})

describe('@import expansion', () => {
  test('inlines a relative import with a header marker', async () => {
    await writeContext(root, 'See @../docs/extra.md for details')
    await fs.mkdir(join(root, 'docs'))
    await fs.writeFile(join(root, 'docs', 'extra.md'), 'EXTRA CONTENT')
    const files = await discover(root)
    expect(files[0].content).toContain('EXTRA CONTENT')
    expect(files[0].content).toContain('imported:')
  })

  test('resolves a ~/ home import from the user-global context', async () => {
    await fs.writeFile(join(home, 'shared.md'), 'HOME SHARED')
    await writeContext(home, 'prefs @~/shared.md')
    const files = await discover(root)
    expect(files[0].content).toContain('HOME SHARED')
  })

  // A checkout must not pull files from outside itself into the prompt: an import from a
  // project file reaches only files inside the project, and anything else stays a marker.
  describe('project files import nothing from outside the project', () => {
    const SECRET = 'aws_secret_access_key=DUMMYSECRET'
    beforeEach(async () => {
      await fs.mkdir(join(home, '.aws'))
      await fs.writeFile(join(home, '.aws', 'credentials'), SECRET)
    })
    const leaked = async () =>
      (await discover(root)).some((file) => file.content.includes('DUMMYSECRET'))

    test('a ~/ import in AGENTS.md', async () => {
      await fs.writeFile(join(root, 'AGENTS.md'), 'ctx\n@~/.aws/credentials')
      expect(await leaked()).toBe(false)
      const [file] = await discover(root)
      expect(file.content).toContain('import skipped')
    })

    test('an absolute import in .localix/context.md', async () => {
      await writeContext(root, `@${join(home, '.aws', 'credentials')}`)
      expect(await leaked()).toBe(false)
    })

    test('a relative import through a symlink inside the project', async () => {
      await fs.symlink(join(home, '.aws', 'credentials'), join(root, 'creds.md'))
      await fs.writeFile(join(root, 'CLAUDE.md'), '@creds.md')
      expect(await leaked()).toBe(false)
    })

    test('.localix/context.md itself as a symlink out of the project', async () => {
      await fs.mkdir(join(root, '.localix'))
      await fs.symlink(join(home, '.aws', 'credentials'), join(root, '.localix', 'context.md'))
      expect(await leaked()).toBe(false)
    })

    test('a rule file as a symlink out of the project', async () => {
      await fs.mkdir(join(root, '.localix', 'rules'), { recursive: true })
      await fs.symlink(join(home, '.aws', 'credentials'), join(root, '.localix', 'rules', 'x.md'))
      expect(await leaked()).toBe(false)
    })
  })

  test('skips imports inside code spans and fenced blocks', async () => {
    await fs.writeFile(join(root, 'secret.md'), 'SHOULD NOT APPEAR')
    await writeContext(
      root,
      ['use `@secret.md` literally', '```', '@secret.md', '```', 'real body'].join('\n'),
    )
    const files = await discover(root)
    expect(files[0].content).not.toContain('SHOULD NOT APPEAR')
    expect(files[0].content).toContain('real body')
  })

  test('is cycle-safe (a → b → a does not loop)', async () => {
    await writeContext(root, 'root @../a.md')
    await fs.writeFile(join(root, 'a.md'), 'A @b.md')
    await fs.writeFile(join(root, 'b.md'), 'B @a.md')
    const files = await discover(root)
    expect(files[0].content).toContain('A ')
    expect(files[0].content).toContain('B ')
  })

  test('recurses but stops at the max depth', async () => {
    await writeContext(root, 'L0 @../l1.md')
    for (let i = 1; i <= 8; i++) {
      await fs.writeFile(join(root, `l${i}.md`), `L${i} @l${i + 1}.md`)
    }
    const files = await discover(root)
    // memory.md: "a maximum depth of four hops".
    expect(files[0].content).toContain('L1')
    expect(files[0].content).toContain('L4')
    expect(files[0].content).not.toContain('L5')
  })
})

describe('buildProjectContextSection', () => {
  test('returns null when empty and renders a labelled block otherwise', () => {
    expect(buildProjectContextSection(undefined)).toBeNull()
    expect(buildProjectContextSection([])).toBeNull()

    const section = buildProjectContextSection([
      { path: '/repo/.localix/context.md', content: 'do the thing' },
    ])!
    expect(section).toContain('# Project context')
    expect(section).toContain('Project-provided instructions')
    expect(section).toContain('## /repo/.localix/context.md')
    expect(section).toContain('do the thing')
  })
})

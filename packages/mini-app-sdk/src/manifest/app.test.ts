import { describe, expect, test } from 'bun:test'
import { MINI_APP_GUIDE_FILE, MINI_APP_MANIFEST_FILE, miniAppManifestSchema } from './app'

const calories = {
  name: 'calories',
  version: '0.1.0',
  description: 'Logs meals the agent reads from photos.',
  category: 'utilities',
  surfaces: ['agent', 'workbench'],
  backend: './backend/index.ts',
}

const problems = (value: unknown) => {
  const parsed = miniAppManifestSchema.safeParse(value)
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)
}

describe('mini-app.json', () => {
  test('is one file at the root of the folder, with its guide beside it', () => {
    expect(MINI_APP_MANIFEST_FILE).toBe('mini-app.json')
    expect(MINI_APP_GUIDE_FILE).toBe('guide.md')
  })

  test('declares the app, its backend, settings and commands with their own prompts', () => {
    const parsed = miniAppManifestSchema.parse({
      ...calories,
      config: { DAILY_GOAL: { type: 'number', default: 2000 } },
      commands: {
        log: {
          description: 'Log a meal',
          prompt: 'Log this meal: $meal',
          args: [{ name: 'meal', type: 'text' }],
          featured: true,
          activateTools: ['calories_log'],
        },
      },
    })
    expect(parsed).toMatchObject({
      name: 'calories',
      version: '0.1.0',
      backend: './backend/index.ts',
      commands: { log: { prompt: 'Log this meal: $meal', featured: true } },
    })
    expect(parsed.guide).toBe('./guide.md')
  })

  test('a catalog needs its version and description', () => {
    expect(problems({ ...calories, version: undefined }).length).toBeGreaterThan(0)
    expect(problems({ ...calories, description: undefined }).length).toBeGreaterThan(0)
  })

  test('a command carries its prompt, and its name is a plain or nested command name', () => {
    expect(problems({ ...calories, commands: { log: { description: 'x' } } }).length).toBe(1)
    expect(problems({ ...calories, commands: { 'Bad Name': { prompt: 'x' } } }).length).toBe(1)
    expect(problems({ ...calories, commands: { 'db:migrate': { prompt: 'x' } } })).toEqual([])
    expect(problems({ ...calories, backend: 3 }).length).toBeGreaterThan(0)
  })

  test('holds nothing of a Claude Code plugin: such a key is refused by name', () => {
    for (const key of ['skills', 'agents', 'hooks', 'mcpServers', 'userConfig', 'dependencies']) {
      const found = problems({ ...calories, [key]: './x' })
      expect(found.join(' '), key).toContain(key)
    }
  })

  test('names its store icon, screenshots and tags, each inside the folder', () => {
    const parsed = miniAppManifestSchema.parse({
      ...calories,
      icon: './icon.svg',
      screenshots: [{ path: './screenshots/log.png', caption: 'A meal, logged' }],
      tags: ['nutrition', 'meal-photos'],
      homepage: 'https://example.com/calories',
    })
    expect(parsed).toMatchObject({ icon: './icon.svg', tags: ['nutrition', 'meal-photos'] })
    expect(parsed.screenshots).toEqual([
      { path: './screenshots/log.png', caption: 'A meal, logged' },
    ])

    expect(problems({ ...calories, icon: '../icon.svg' })).toEqual([
      'A path must stay inside the mini app folder: relative, with no ".."',
    ])
    expect(problems({ ...calories, tags: ['Board Game'] })).toEqual([
      'A tag is lower-case words joined by dashes, such as "board-game"',
    ])
    expect(problems({ ...calories, tags: 'abcdefghi'.split('') }).length).toBe(1)
    const eleven = Array.from({ length: 11 }, (_, i) => ({ path: `s/${i}.png` }))
    expect(problems({ ...calories, screenshots: eleven }).length).toBe(1)
    expect(problems({ ...calories, screenshots: [{ path: 's.png', alt: 'x' }] }).length).toBe(1)
  })

  test('the author is a bare string or the object form, and nothing else', () => {
    const author = (value: unknown) => problems({ ...calories, author: value }).length === 0
    expect(author('Ada')).toBe(true)
    expect(author({ name: 'Ada', email: 'ada@example.com', url: 'https://example.com' })).toBe(true)
    expect(author(42)).toBe(false)
    expect(author({ name: 42 })).toBe(false)
  })
})

import { describe, expect, test } from 'bun:test'
import { composeManifest, type ManifestFiles } from './compose'

const plugin = (json: unknown): ManifestFiles['plugin'] => ({
  file: '.claude-plugin/plugin.json',
  json,
})
const app = (json: unknown): ManifestFiles['app'] => ({ file: '.localix-app/app.json', json })

describe('composeManifest', () => {
  test('a Claude Code plugin loads in place, with Claude Code’s rules made explicit', () => {
    const composed = composeManifest(
      {
        plugin: plugin({
          name: 'deploy',
          version: '1.0.0',
          commands: ['./cmd/ship.md'],
          userConfig: {
            TOKEN: { type: 'string', title: 'Token', description: 'API token', sensitive: true },
          },
          experimental: { monitors: [{ name: 'tail', command: 'tail -f x', description: 'x' }] },
          outputStyles: './styles',
        }),
      },
      'deploy-folder',
    )
    expect(composed.layout).toBe('plugin')
    expect(composed.raw).toMatchObject({
      name: 'deploy',
      version: '1.0.0',
      commands: ['./cmd/ship.md'],
      defaultDirs: { commands: false },
      config: { TOKEN: { type: 'string', title: 'Token', secret: true } },
      monitors: [{ name: 'tail' }],
      origin: { format: 'claude-code' },
    })
    expect(composed.issues).toEqual([
      expect.objectContaining({ severity: 'warning', path: 'outputStyles' }),
    ])
  })

  test('a mini app adds the Localix layer over the plugin in its folder', () => {
    const composed = composeManifest(
      {
        plugin: plugin({ name: 'tiles', version: '0.2.0', description: 'Play tiles' }),
        app: app({
          name: 'tiles',
          version: '9.9.9',
          displayName: 'Tiles',
          category: 'games',
          surfaces: ['agent', 'workbench'],
          backend: './backend/index.ts',
          config: { LEVEL: { type: 'number', default: 3 } },
          commands: { play: { featured: true } },
        }),
      },
      'tiles',
    )
    expect(composed.layout).toBe('mini-app')
    expect(composed.raw).toMatchObject({
      name: 'tiles',
      // The plugin keeps its version; the mini app speaks for display.
      version: '0.2.0',
      displayName: 'Tiles',
      description: 'Play tiles',
      category: 'games',
      tools: './backend/index.ts',
      config: { LEVEL: { type: 'number', default: 3 } },
      commandOptions: { play: { featured: true } },
    })
  })

  test('a key both layers configure is the plugin’s', () => {
    const composed = composeManifest(
      {
        plugin: plugin({
          name: 'svc',
          userConfig: { URL: { type: 'string', title: 'URL', description: 'From the plugin' } },
        }),
        app: app({ name: 'svc', config: { URL: { type: 'string', description: 'From the app' } } }),
      },
      'svc',
    )
    expect(composed.raw?.config).toEqual({
      URL: { type: 'string', title: 'URL', description: 'From the plugin' },
    })
  })

  test('a mini app without a plugin manifest is still one extension, named by the app', () => {
    const composed = composeManifest({ app: app({ name: 'board', backend: './b.ts' }) }, 'x')
    expect(composed.raw).toMatchObject({ name: 'board', tools: './b.ts' })
  })

  test('a mini app and its plugin share one name', () => {
    const composed = composeManifest(
      { plugin: plugin({ name: 'a' }), app: app({ name: 'b' }) },
      'a',
    )
    expect(composed.raw).toBeNull()
    expect(composed.error).toContain('share one name')
  })

  test('a legacy root plugin.json still loads; next to a new manifest it is ignored', () => {
    const legacy = { file: 'plugin.json', json: { name: 'old', tools: './tools/index.ts' } }
    expect(composeManifest({ legacy }, 'old')).toMatchObject({
      layout: 'legacy',
      raw: { name: 'old', tools: './tools/index.ts' },
    })
    const both = composeManifest({ legacy, plugin: plugin({ name: 'old' }) }, 'old')
    expect(both.raw).not.toHaveProperty('tools')
    expect(both.issues[0]).toMatchObject({ severity: 'warning', path: 'plugin.json' })
  })

  test('the plugin.json an earlier Claude Code import wrote is ignored without a warning', () => {
    const composed = composeManifest(
      {
        legacy: { file: 'plugin.json', json: { name: 'p', origin: { format: 'claude-code' } } },
        plugin: plugin({ name: 'p' }),
      },
      'p',
    )
    expect(composed.issues).toEqual([])
  })

  test('without any manifest the folder is a plugin named after itself', () => {
    expect(composeManifest({}, 'tools')).toEqual({ layout: 'plugin', raw: null, issues: [] })
  })

  test('an unreadable or invalid manifest says which file and why', () => {
    const unreadable = composeManifest(
      { plugin: { file: '.claude-plugin/plugin.json', readError: 'Invalid x: bad JSON' } },
      'p',
    )
    expect(unreadable.error).toBe('Invalid x: bad JSON')
    const invalid = composeManifest({ plugin: plugin({ name: 'has space' }) }, 'p')
    expect(invalid.error).toContain('may not contain spaces')
    const badApp = composeManifest({ app: app({ name: 'x', backend: 3 }) }, 'x')
    expect(badApp.error).toContain('.localix-app/app.json')
  })
})

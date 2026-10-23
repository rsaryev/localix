import { describe, expect, test } from 'bun:test'
import { composeManifest, type ManifestFiles } from './compose'

const plugin = (json: unknown): ManifestFiles['plugin'] => ({
  file: '.claude-plugin/plugin.json',
  json,
})

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
    expect(composed.raw).toMatchObject({
      name: 'deploy',
      version: '1.0.0',
      commands: ['./cmd/ship.md'],
      defaultDirs: { commands: false },
      config: { TOKEN: { type: 'string', title: 'Token', secret: true } },
      monitors: [{ name: 'tail' }],
      origin: { format: 'claude-code' },
      outputStyles: './styles',
    })
    expect(composed.issues).toEqual([])
  })

  test('a root plugin.json is not read, as in Claude Code, and says so', () => {
    const root = { file: 'plugin.json', json: { name: 'old', tools: './tools/index.ts' } }
    const alone = composeManifest({ root }, 'old')
    expect(alone.raw).toBeNull()
    expect(alone.error).toBeUndefined()
    expect(alone.issues[0]).toMatchObject({ severity: 'warning', path: 'plugin.json' })
    const both = composeManifest({ root, plugin: plugin({ name: 'old' }) }, 'old')
    expect(both.raw).not.toHaveProperty('tools')
  })

  test('the plugin.json an earlier Claude Code import wrote is ignored without a warning', () => {
    const composed = composeManifest(
      {
        root: { file: 'plugin.json', json: { name: 'p', origin: { format: 'claude-code' } } },
        plugin: plugin({ name: 'p' }),
      },
      'p',
    )
    expect(composed.issues).toEqual([])
  })

  test('a folder holding a mini app is never a plugin (rule X2)', () => {
    const composed = composeManifest(
      { miniApp: true, plugin: plugin({ name: 'tracker' }) },
      'tracker',
    )
    expect(composed.raw).toBeNull()
    expect(composed.error).toContain('is a mini app')
  })

  test('without any manifest the folder is a plugin named after itself', () => {
    expect(composeManifest({}, 'tools')).toEqual({ raw: null, issues: [] })
  })

  test('an unreadable or invalid manifest says which file and why', () => {
    const unreadable = composeManifest(
      { plugin: { file: '.claude-plugin/plugin.json', readError: 'Invalid x: bad JSON' } },
      'p',
    )
    expect(unreadable.error).toBe('Invalid x: bad JSON')
    const invalid = composeManifest({ plugin: plugin({ name: 'has space' }) }, 'p')
    expect(invalid.error).toContain('may not contain spaces')
  })
})

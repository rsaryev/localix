import { describe, expect, test } from 'bun:test'
import { parseLspServersConfig, configuredLspServer } from './lsp-plugin-servers'

describe('parseLspServersConfig', () => {
  test('parses the CC rust-analyzer shape (extensionToLanguage, no args)', () => {
    // Real entry from claude-plugins-official rust-analyzer-lsp.
    const cfg = parseLspServersConfig({
      'rust-analyzer': { command: 'rust-analyzer', extensionToLanguage: { '.rs': 'rust' } },
    })
    expect(cfg['rust-analyzer']).toEqual({
      command: 'rust-analyzer',
      extensionToLanguage: { '.rs': 'rust' },
    })
  })

  test('parses clangd with args + multi-extension map, normalizing extensions', () => {
    // Real entry from claude-plugins-official clangd-lsp (has mixed-case .C/.H keys).
    const cfg = parseLspServersConfig({
      clangd: {
        command: 'clangd',
        args: ['--background-index'],
        extensionToLanguage: { '.c': 'c', '.cpp': 'cpp', '.C': 'cpp', '.H': 'cpp' },
      },
    })
    expect(cfg.clangd.command).toBe('clangd')
    expect(cfg.clangd.args).toEqual(['--background-index'])
    // Keys normalized to lowercase, leading-dot form (dedupes .C onto .c).
    expect(Object.keys(cfg.clangd.extensionToLanguage).sort()).toEqual(['.c', '.cpp', '.h'])
  })

  test('accepts a {lspServers:{…}} wrapper (a .lsp.json file body)', () => {
    const cfg = parseLspServersConfig({
      lspServers: { gopls: { command: 'gopls', extensionToLanguage: { '.go': 'go' } } },
    })
    expect(Object.keys(cfg)).toEqual(['gopls'])
  })

  test('normalizes bare extension keys to leading-dot form', () => {
    const cfg = parseLspServersConfig({ x: { command: 'x', extensionToLanguage: { rs: 'rust' } } })
    expect(cfg.x.extensionToLanguage).toEqual({ '.rs': 'rust' })
  })

  test('drops entries missing command or extensionToLanguage', () => {
    const cfg = parseLspServersConfig({
      noCmd: { extensionToLanguage: { '.a': 'a' } },
      noExt: { command: 'srv' },
      empty: { command: 'srv', extensionToLanguage: {} },
      ok: { command: 'srv', extensionToLanguage: { '.a': 'a' } },
    })
    expect(Object.keys(cfg)).toEqual(['ok'])
  })

  test('carries optional env / initializationOptions / startupTimeout', () => {
    const cfg = parseLspServersConfig({
      s: {
        command: 'srv',
        extensionToLanguage: { '.a': 'a' },
        env: { FOO: 'bar', BAD: 1 as never },
        initializationOptions: { deep: true },
        startupTimeout: 5000,
      },
    })
    expect(cfg.s.env).toEqual({ FOO: 'bar' })
    expect(cfg.s.initializationOptions).toEqual({ deep: true })
    expect(cfg.s.startupTimeout).toBe(5000)
  })

  test('non-object input → empty', () => {
    expect(parseLspServersConfig(null)).toEqual({})
    expect(parseLspServersConfig('x' as never)).toEqual({})
  })
})

describe('configuredLspServer', () => {
  test('builds an LspServerDef handling the config extensions, rooted at projectRoot', () => {
    const [cfg] = Object.values(
      parseLspServersConfig({
        'rust-analyzer': { command: 'rust-analyzer', extensionToLanguage: { '.rs': 'rust' } },
      }),
    )
    const def = configuredLspServer('plug:rust-analyzer', cfg)
    expect(def.id).toBe('plug:rust-analyzer')
    expect(def.extensions).toEqual(['.rs'])
    expect(def.resolveRoot('/proj/src/main.rs', '/proj')).toBe('/proj')
  })

  test('spawn yields undefined when the binary is not on PATH (graceful)', async () => {
    const def = configuredLspServer('p:nope', {
      command: 'definitely-not-a-real-binary-xyz',
      extensionToLanguage: { '.rs': 'rust' },
    })
    expect(await def.spawn('/tmp', '/tmp')).toBeUndefined()
  })
})

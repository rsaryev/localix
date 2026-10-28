import { describe, expect, test } from 'bun:test'
import path from 'node:path'

import { commandInstall } from './lsp-command-installs'
import { LSP_PACKAGES, parseSource } from './lsp-registry'

/** The platforms the desktop app is released for. */
const SHIPPED = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64']

describe('package URLs', () => {
  test('name where a server comes from and at which version', () => {
    expect(parseSource('pkg:npm/%40vtsls/language-server@0.3.0')).toEqual({
      type: 'npm',
      name: '@vtsls/language-server',
      version: '0.3.0',
    })
    expect(parseSource('pkg:github/rust-lang/rust-analyzer@2026-10-12')).toEqual({
      type: 'github',
      repo: 'rust-lang/rust-analyzer',
      version: '2026-10-12',
    })
    expect(parseSource('pkg:golang/golang.org/x/tools/gopls@v0.24.0')).toEqual({
      type: 'golang',
      module: 'golang.org/x/tools/gopls',
      version: 'v0.24.0',
    })
  })

  test('one without a version, or of a kind Localix cannot install, is refused', () => {
    expect(() => parseSource('pkg:npm/pyright')).toThrow('pkg:npm/pyright')
    expect(() => parseSource('pkg:cargo/taplo-cli@0.9.0')).toThrow('pkg:cargo')
  })
})

describe('the registry Localix ships', () => {
  test('every server installs on every released platform, and no command has two owners', () => {
    const owners = new Map<string, string>()
    for (const pkg of Object.values(LSP_PACKAGES)) {
      expect(pkg.bin.length).toBeGreaterThan(0)
      if (pkg.source.type === 'github')
        for (const platform of SHIPPED) expect(pkg.assets[platform]).toBeDefined()
      for (const bin of pkg.bin) {
        expect(owners.get(bin)).toBeUndefined()
        owners.set(bin, pkg.id)
      }
    }
  })

  test('a command a plugin names is found in the package that provides it', () => {
    expect(commandInstall('vtsls')).toEqual({ package: 'typescript', npmBin: 'vtsls' })
    expect(commandInstall('vscode-css-language-server')).toMatchObject({
      package: 'vscode-langservers',
    })
    const install = path.join('/installs', 'gopls', 'v1')
    expect(commandInstall('gopls')?.executable?.(install)).toStartWith(
      path.join(install, 'bin', 'gopls'),
    )
    expect(commandInstall('rust-analyzer')?.executable?.(install)).toStartWith(
      path.join(install, 'rust-analyzer'),
    )
    expect(commandInstall('/opt/bin/gopls')).toBeUndefined()
    expect(commandInstall('clangd')).toBeUndefined()
  })
})

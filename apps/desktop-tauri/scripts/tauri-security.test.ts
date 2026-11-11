import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The shell's IPC and content boundary, held as configuration (README, "Tauri practices").
 *
 * Each rule is checked on the committed configuration and on a copy broken in the one way the rule
 * exists to catch, so a guard that stopped seeing its mistake fails here too.
 */
const SRC_TAURI = new URL('../src-tauri/', import.meta.url).pathname
const UI_SRC = new URL('../../ui/src/', import.meta.url).pathname

type Capability = {
  identifier: string
  webviews?: string[]
  windows?: string[]
  remote?: unknown
  permissions: (string | { identifier: string })[]
}
type Conf = {
  app: {
    withGlobalTauri?: boolean
    security: {
      csp?: string
      capabilities?: string[]
      assetProtocol?: { enable?: boolean }
      dangerousDisableAssetCspModification?: unknown
    }
  }
  build: { removeUnusedCommands?: boolean }
}

const readJson = <T>(file: string) => JSON.parse(readFileSync(join(SRC_TAURI, file), 'utf8')) as T
const conf = readJson<Conf>('tauri.conf.json')
const capabilities = readdirSync(join(SRC_TAURI, 'capabilities')).map((file) =>
  readJson<Capability>(join('capabilities', file)),
)

/** Labels of webviews that show what the app did not write: `native_browser::page_label`. */
const UNTRUSTED_LABELS = ['browser-main--tab1', 'browser-workspace-2--a', 'browser-island--x']
/** Plugins the shell drives from Rust only; the README's table says why no webview may reach them. */
const RUST_ONLY_PLUGINS = ['shell', 'updater', 'deep-link', 'window-state', 'fs', 'dialog']
/** CSP directives without which an injected script gets further than it should. */
const REQUIRED_CSP = ["default-src 'self'", "object-src 'none'", "base-uri 'self'"]

/** A capability's `webviews`/`windows` glob, as Tauri matches it (`*` is any run of characters). */
const matches = (pattern: string, label: string) =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replaceAll('*', '.*')}$`, 'u').test(
    label,
  )

function problems(config: Conf, caps: Capability[]) {
  const found: string[] = []
  const enabled = caps.filter((cap) => config.app.security.capabilities?.includes(cap.identifier))
  if (!config.app.security.capabilities) found.push('every capability file is enabled by existing')
  for (const cap of enabled) {
    const targets = [...(cap.webviews ?? []), ...(cap.windows ?? [])]
    for (const label of UNTRUSTED_LABELS)
      if (targets.some((pattern) => matches(pattern, label)))
        found.push(`${cap.identifier} reaches ${label}`)
    if (cap.remote) found.push(`${cap.identifier} grants IPC to remote URLs`)
    for (const permission of cap.permissions) {
      const id = typeof permission === 'string' ? permission : permission.identifier
      if (RUST_ONLY_PLUGINS.includes(id.split(':')[0] ?? ''))
        found.push(`${cap.identifier} grants ${id}`)
    }
  }
  const csp = config.app.security.csp ?? ''
  for (const directive of REQUIRED_CSP)
    if (!csp.split(';').some((part) => part.trim() === directive))
      found.push(`the CSP lacks ${directive}`)
  if (/'unsafe-eval'/u.test(csp)) found.push("the CSP allows 'unsafe-eval'")
  if (config.app.security.dangerousDisableAssetCspModification !== undefined)
    found.push('Tauri no longer adds its nonces and hashes to the CSP')
  if (config.app.security.assetProtocol?.enable) found.push('the asset protocol serves files')
  if (config.build.removeUnusedCommands !== true)
    found.push('plugin commands no permission admits stay compiled in')
  return found
}

const broken = (edit: (copy: Conf, caps: Capability[]) => void) => {
  const copy = structuredClone(conf)
  const caps = structuredClone(capabilities)
  edit(copy, caps)
  return problems(copy, caps)
}

describe('the IPC and content boundary', () => {
  test('the committed configuration keeps it', () => {
    expect(problems(conf, capabilities)).toEqual([])
  })

  test('a capability that reaches a browser page is caught', () => {
    expect(broken((_, caps) => caps[0]?.webviews?.push('*'))).toContain(
      'default reaches browser-main--tab1',
    )
  })

  test('a capability for remote URLs, or a Rust-only plugin granted, is caught', () => {
    const found = broken((_, caps) => {
      if (!caps[0]) return
      caps[0].remote = { urls: ['https://*'] }
      caps[0].permissions.push('shell:allow-execute')
    })
    expect(found).toContain('default grants IPC to remote URLs')
    expect(found).toContain('default grants shell:allow-execute')
  })

  test('capability files are enabled by name, not by being in the folder', () => {
    expect(broken((copy) => delete copy.app.security.capabilities)).toContain(
      'every capability file is enabled by existing',
    )
  })

  test('a CSP that is gone, eval-able or loses its hashes is caught', () => {
    expect(broken((copy) => delete copy.app.security.csp)).toContain(
      "the CSP lacks object-src 'none'",
    )
    expect(
      broken((copy) => {
        copy.app.security.csp += "; script-src 'unsafe-eval'"
        copy.app.security.dangerousDisableAssetCspModification = true
      }),
    ).toEqual([
      "the CSP allows 'unsafe-eval'",
      'Tauri no longer adds its nonces and hashes to the CSP',
    ])
  })

  test('the asset protocol and unused plugin commands stay off', () => {
    expect(
      broken((copy) => {
        copy.app.security.assetProtocol = { enable: true }
        copy.build.removeUnusedCommands = false
      }),
    ).toEqual([
      'the asset protocol serves files',
      'plugin commands no permission admits stay compiled in',
    ])
  })
})

/** Every UI source file, tests excluded. */
function uiSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return uiSources(path)
    return /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) ? [path] : []
  })
}

test('window.__TAURI__ (withGlobalTauri) is read in one file, so turning it off is one change', () => {
  // The global hands the Tauri API to every script in the document. It stays while the UI keeps
  // no `@tauri-apps/api` dependency; one reader keeps the way off it a one-file change.
  expect(conf.app.withGlobalTauri).toBe(true)
  const readers = uiSources(UI_SRC).filter((file) =>
    /\.__TAURI__\b/u.test(readFileSync(file, 'utf8')),
  )
  expect(readers.map((file) => file.slice(UI_SRC.length))).toEqual(['shared/lib/tauri.ts'])
})

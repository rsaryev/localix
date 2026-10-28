import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { sharedShim } from '../plugins/mini-app-authoring/src/build/ui-shared-modules'
import { type Kit as MiniAppKit, loadKit } from '../plugins/mini-app-authoring/src/kit/kit'
import { buildAndPublishMiniAppUi, publishMiniAppUi } from './build-mini-app-ui.mjs'
import { NO_SOURCE_MAPS_FLAG, stageMiniAppUi, takeStagedUiArtifact } from './stage-mini-app-ui.mjs'
import { kitCacheRoot } from './mini-app-kit-cache.mjs'

const repoRoot = resolve(import.meta.dir, '..')
const root = mkdtempSync(join(tmpdir(), 'mini-app-ui-artifact-'))
let kit: MiniAppKit
let dirs = 0

beforeAll(async () => {
  // A child, as staging runs it (see mini-app-kit.integration.test.ts). Synchronous, so the hook's
  // own 30 s timeout cannot fire while it blocks: the child gets its OWN deadline, or a stalled
  // staging froze this whole test process (found at 1000% CPU after eight minutes).
  // Reuses a kit staged for identical inputs (`mini-app-kit-cache.mjs`).
  execFileSync(
    'bun',
    [
      join(import.meta.dir, 'stage-mini-app-kit.mjs'),
      repoRoot,
      join(root, 'kit'),
      `--cache=${kitCacheRoot(repoRoot)}`,
    ],
    { stdio: 'pipe', timeout: 60_000, killSignal: 'SIGKILL' },
  )
  kit = await loadKit(join(root, 'kit'))
}, 30_000)
afterAll(() => rmSync(root, { recursive: true, force: true }))

function tempDir(): string {
  const dir = join(root, `t${dirs++}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/** A mini app with an eager entry and a lazy chunk that alone needs the heavy kit module. */
function fixtureMiniApp(extra: Record<string, string> = {}): string {
  const miniApp = join(tempDir(), 'fixture')
  write(
    join(miniApp, 'ui', 'register.tsx'),
    [
      "import { useState } from 'react'",
      "import { Button } from '@localixai/kit/button'",
      "import { Timer } from 'lucide-react'",
      'export const lazyPanel = () => import("./Panel")',
      'export function registerUi() { return [useState, Button, Timer] }',
      'export const Mark = () => <span className="text-text-soft text-(--chart-2) max-w-[min(26rem,100%)]">mark</span>',
    ].join('\n'),
  )
  // `ui/runtime` re-exports through an extensionless `export *` in the SDK's dist.
  write(
    join(miniApp, 'ui', 'Panel.tsx'),
    [
      "import { CodeEditor } from '@localixai/kit/code-editor'",
      "import { miniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime'",
      'export const Panel = [CodeEditor, miniAppWorkspace]',
    ].join('\n'),
  )
  for (const [path, content] of Object.entries(extra)) write(join(miniApp, path), content)
  return miniApp
}

const read = (dir: string, file: string) => readFileSync(join(dir, file), 'utf8')
const chunks = (dir: string) => readdirSync(join(dir, 'chunks')).filter((f) => f.endsWith('.js'))
const build = (miniAppDir: string, outDir = join(tempDir(), 'out')) =>
  buildAndPublishMiniAppUi({ kit, miniAppDir, outDir })

test('relocated media encoding vendor retains its browser exclusions without node_modules', async () => {
  const miniApp = fixtureMiniApp({
    'ui/Panel.tsx':
      "import { CanvasSource, BufferTarget, Output, Mp4OutputFormat } from 'mediabunny'\nexport const Panel = [CanvasSource, BufferTarget, Output, Mp4OutputFormat]\n",
  })
  const out = join(tempDir(), 'media')
  await build(miniApp, out)
  const code = [
    read(out, 'entry.js'),
    ...chunks(out).map((file) => read(join(out, 'chunks'), file)),
  ].join('\n')
  expect(code).not.toContain('node:fs')
  expect(code).not.toContain('node:stream')
  expect(code).not.toContain('Cannot find module')
  expect(code).toContain('video/mp4')
})

describe('mini app UI artifact', () => {
  test('bundles the mini app, takes shared modules from the host, loads the heavy one lazily', async () => {
    const out = join(tempDir(), 'out')
    const manifest = await build(fixtureMiniApp(), out)
    expect(manifest).toMatchObject({ entry: 'entry.js', styles: ['utilities.css'] })
    expect(manifest?.revision).toMatch(/^[0-9a-f]{16}$/u)
    expect(JSON.parse(read(out, 'manifest.json'))).toEqual(manifest)

    const eager = [read(out, 'entry.js'), ...chunks(out).map((c) => read(join(out, 'chunks'), c))]
    const holding = (call: string) => eager.filter((code) => code.includes(call)).length
    // React and the button come from the host; React is preloaded, so it is read synchronously.
    expect(holding('.require("react")')).toBeGreaterThan(0)
    expect(holding('.load("react")')).toBe(0)
    expect(holding('.load("@localixai/kit/button")')).toBeGreaterThan(0)
    expect(eager.join('\n')).not.toContain('react.production')
    // The code editor is requested only by the chunk the lazy import loads.
    const editorChunks = chunks(out).filter((c) =>
      read(join(out, 'chunks'), c).includes('.load("@localixai/kit/code-editor")'),
    )
    expect(editorChunks).toHaveLength(1)
    // Icons come from the kit's copy, per icon: one icon, not the whole set.
    expect(eager.join('\n').length).toBeLessThan(60_000)
    // Utilities the mini app uses, against the host theme — and nothing else.
    expect(read(out, 'utilities.css')).toContain('.text-text-soft')
    expect(read(out, 'utilities.css')).not.toContain('box-sizing')
    // A value holding parentheses or a comma is one class too, not a class the build never saw.
    expect(read(out, 'utilities.css')).toContain('var(--chart-2)')
    expect(read(out, 'utilities.css')).toContain('min(26rem')
  })

  // A user mini app is debugged from the maps beside it; release staging of the first-party mini
  // apps leaves them out (17 MB of the installer). Both halves, so neither default can drift.
  test('source maps are emitted by default and left out when asked', async () => {
    const withMaps = join(tempDir(), 'out')
    await build(fixtureMiniApp(), withMaps)
    expect(existsSync(join(withMaps, 'entry.js.map'))).toBe(true)
    expect(read(withMaps, 'entry.js')).toContain('sourceMappingURL=entry.js.map')

    const withoutMaps = join(tempDir(), 'out')
    await buildAndPublishMiniAppUi({
      kit,
      miniAppDir: fixtureMiniApp(),
      outDir: withoutMaps,
      sourceMaps: false,
    })
    const files = readdirSync(withoutMaps, { recursive: true }).map(String)
    expect(files.filter((file) => file.endsWith('.map'))).toEqual([])
    expect(read(withoutMaps, 'entry.js')).not.toContain('sourceMappingURL')
  })

  test('the revision is a content hash: same sources, same revision; an edit moves it', async () => {
    const miniApp = fixtureMiniApp()
    const first = await build(miniApp)
    expect((await build(miniApp))?.revision).toBe(first?.revision)
    write(join(miniApp, 'ui', 'Panel.tsx'), "export const Panel = () => 'edited'\n")
    expect((await build(miniApp))?.revision).not.toBe(first?.revision)
  })

  test('retains one previous set of lazy chunks without changing the current revision', async () => {
    const miniApp = fixtureMiniApp()
    const out = join(tempDir(), 'out')
    const currentChunks = () =>
      (JSON.parse(read(out, '.current-files.json')) as string[]).filter((file) =>
        file.startsWith('chunks/'),
      )

    const first = await build(miniApp, out)
    const firstChunk = currentChunks()[0]!
    write(join(miniApp, 'ui', 'Panel.tsx'), "export const Panel = () => 'second'\n")
    const second = await build(miniApp, out)
    const secondChunk = currentChunks()[0]!
    expect(second?.revision).not.toBe(first?.revision)
    expect(secondChunk).not.toBe(firstChunk)
    expect(existsSync(join(out, firstChunk))).toBe(true)
    expect(JSON.parse(read(out, 'manifest.json'))).toEqual(second)

    write(join(miniApp, 'ui', 'Panel.tsx'), "export const Panel = () => 'third'\n")
    const third = await build(miniApp, out)
    expect(third?.revision).not.toBe(second?.revision)
    expect(existsSync(join(out, firstChunk))).toBe(false)
    expect(existsSync(join(out, secondChunk))).toBe(true)
  })

  test('a failed rebuild keeps the last complete artifact until a successful replacement', async () => {
    const miniApp = fixtureMiniApp()
    const out = join(tempDir(), 'out')
    const first = await build(miniApp, out)
    const before = {
      manifest: read(out, 'manifest.json'),
      entry: read(out, 'entry.js'),
      styles: read(out, 'utilities.css'),
      chunks: chunks(out).map((file) => [file, read(join(out, 'chunks'), file)]),
    }

    write(join(miniApp, 'ui', 'register.tsx'), 'export const broken = (\n')
    await expect(build(miniApp, out)).rejects.toThrow('UI build failed')
    expect({
      manifest: read(out, 'manifest.json'),
      entry: read(out, 'entry.js'),
      styles: read(out, 'utilities.css'),
      chunks: chunks(out).map((file) => [file, read(join(out, 'chunks'), file)]),
    }).toEqual(before)
    expect(readdirSync(dirname(out)).some((file) => file.startsWith('.out-staging-'))).toBe(false)

    write(join(miniApp, 'ui', 'register.tsx'), 'export const repaired = true\n')
    const next = await build(miniApp, out)
    expect(next?.revision).not.toBe(first?.revision)
    expect(JSON.parse(read(out, 'manifest.json'))).toEqual(next)
    expect(read(out, 'entry.js')).toContain('repaired')
    expect(readdirSync(dirname(out)).some((file) => file.startsWith('.out-previous-'))).toBe(false)
  })

  test('a stylesheet failure after bundling preserves the live artifact', async () => {
    const miniApp = fixtureMiniApp()
    const out = join(tempDir(), 'out')
    await build(miniApp, out)
    const before = read(out, 'manifest.json')
    const kitWithMissingTheme: MiniAppKit = {
      ...kit,
      manifest: { ...kit.manifest, hostStylesheet: 'ui/styles/missing.css' },
    }
    await expect(
      buildAndPublishMiniAppUi({ kit: kitWithMissingTheme, miniAppDir: miniApp, outDir: out }),
    ).rejects.toThrow()
    expect(read(out, 'manifest.json')).toBe(before)
    expect(existsSync(join(out, 'entry.js'))).toBe(true)
  })

  test('a failed publication restores the previous artifact', async () => {
    const out = join(tempDir(), 'out')
    write(join(out, 'manifest.json'), '{"revision":"previous"}')
    await expect(publishMiniAppUi(join(dirname(out), 'missing-candidate'), out)).rejects.toThrow()
    expect(read(out, 'manifest.json')).toBe('{"revision":"previous"}')
    expect(readdirSync(dirname(out)).some((file) => file.startsWith('.out-previous-'))).toBe(false)
  })

  test('refuses host internals: a mini app reaches the host only through the kit', async () => {
    // With the `@/*` mapping real mini apps carry for the compiler: the boundary must hold even
    // where the path WOULD resolve.
    const miniApp = fixtureMiniApp({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { paths: { '@/*': [`${repoRoot}/apps/ui/src/*`] } },
      }),
      'ui/Leak.ts': "export { Button } from '@/shared/ui/button'\n",
      'ui/register.tsx': "export { Button } from './Leak'\nexport function registerUi() {}\n",
    })
    await expect(build(miniApp)).rejects.toThrow('imports host internals ("@/shared/ui/button")')
  })

  test('refuses static, dynamic and absolute imports outside the mini app', async () => {
    for (const source of [
      (_outside: string) => `import { secret } from '../../outside'\nexport const value = secret\n`,
      (_outside: string) => `export const load = () => import('../../outside')\n`,
      (outside: string) =>
        `import { secret } from ${JSON.stringify(outside)}\nexport const value = secret\n`,
    ]) {
      const miniApp = fixtureMiniApp()
      const outside = join(dirname(miniApp), 'outside.ts')
      write(outside, 'export const secret = "outside"\n')
      write(join(miniApp, 'ui', 'register.tsx'), source(outside))
      await expect(build(miniApp)).rejects.toThrow('outside the mini app')
    }
  })

  test('refuses a tsconfig bare alias that resolves outside the mini app', async () => {
    const miniApp = fixtureMiniApp()
    const outside = join(dirname(miniApp), 'outside.ts')
    write(outside, 'export const secret = "outside"\n')
    write(
      join(miniApp, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { paths: { alias: ['../outside.ts'] } } }),
    )
    write(
      join(miniApp, 'ui', 'register.tsx'),
      "import { secret } from 'alias'\nexport const value = secret\n",
    )
    await expect(build(miniApp)).rejects.toThrow('outside the mini app')
  })

  test('admits a dependency Bun hoisted above the mini app, with its own internal imports', async () => {
    // Bun workspaces install a mini app's dependency into an ANCESTOR `node_modules`, so the file
    // is outside the mini app by path. Refusing it took the UI of every bundled mini app with a
    // dependency down; the package's own relative and self-subpath imports are its code.
    const miniApp = fixtureMiniApp()
    const pkg = join(dirname(miniApp), 'node_modules', 'hoisted-dep')
    write(
      join(pkg, 'package.json'),
      JSON.stringify({
        name: 'hoisted-dep',
        type: 'module',
        exports: { '.': './index.js', './sub': './sub.js' },
      }),
    )
    write(
      join(pkg, 'index.js'),
      "export { part } from './part.js'\nexport { sub } from 'hoisted-dep/sub'\n",
    )
    write(join(pkg, 'part.js'), 'export const part = 1\n')
    write(join(pkg, 'sub.js'), 'export const sub = 2\n')
    write(
      join(miniApp, 'ui', 'register.tsx'),
      "import { part, sub } from 'hoisted-dep'\nexport function registerUi() { return part + sub }\n",
    )
    expect(await build(miniApp)).toMatchObject({ entry: 'entry.js' })

    // The mini app's OWN relative escape is still refused beside an admitted dependency.
    write(join(dirname(miniApp), 'outside.ts'), 'export const secret = "outside"\n')
    write(
      join(miniApp, 'ui', 'register.tsx'),
      "import { part } from 'hoisted-dep'\nimport { secret } from '../../outside'\nexport const v = [part, secret]\n",
    )
    await expect(build(miniApp)).rejects.toThrow('outside the mini app')
  })

  test('refuses an import that escapes through a source symlink', async () => {
    if (process.platform === 'win32') return // Creating a symlink may require elevated privileges.
    const miniApp = fixtureMiniApp()
    const outside = join(dirname(miniApp), 'outside.ts')
    write(outside, 'export const secret = "outside"\n')
    symlinkSync(outside, join(miniApp, 'ui', 'link.ts'))
    write(join(miniApp, 'ui', 'register.tsx'), "export { secret } from './link'\n")
    await expect(build(miniApp)).rejects.toThrow('outside the mini app')
  })

  test('a mini app without a UI entry has no artifact', async () => {
    const miniApp = join(tempDir(), 'backend-only')
    write(join(miniApp, 'backend', 'index.ts'), 'export {}\n')
    expect(await build(miniApp)).toBeNull()
  })

  test('removing the UI entry removes a previously built artifact', async () => {
    const miniApp = fixtureMiniApp()
    const out = join(tempDir(), 'out')
    await build(miniApp, out)
    rmSync(join(miniApp, 'ui', 'register.tsx'))
    expect(await build(miniApp, out)).toBeNull()
    expect(existsSync(out)).toBe(false)
  })

  test('a shim re-exports exactly the given names; only preloaded modules are read synchronously', () => {
    expect(
      sharedShim(kit.tools.ui, 'react', ['useState', 'default', 'not-an-identifier', 'useState']),
    ).toBe(
      [
        'const m = globalThis["__LOCALIX_MINI_APP_UI_SHARED__"].require("react")',
        'module.exports = { __esModule: true, default: m.default, useState: m.useState }',
      ].join('\n'),
    )
    expect(sharedShim(kit.tools.ui, '@localixai/kit/button', ['Button'])).toStartWith(
      'const m = await globalThis["__LOCALIX_MINI_APP_UI_SHARED__"].load("@localixai/kit/button")',
    )
  })

  // An older CommonJS dependency `require`s React (`@xyflow/react` → `use-sync-external-store`),
  // and Bun refuses a `require` whose chain reaches a top-level `await`.
  test('a CommonJS dependency that requires React builds', async () => {
    const miniApp = fixtureMiniApp({
      'node_modules/legacy-hook/package.json': '{"name":"legacy-hook","main":"index.js"}',
      'node_modules/legacy-hook/index.js':
        "'use strict'\nvar React = require('react')\nmodule.exports = function use() { return React.useState }\n",
      'ui/Legacy.ts': "import use from 'legacy-hook'\nexport const legacy = use\n",
      'ui/register.tsx': "export { legacy } from './Legacy'\nexport function registerUi() {}\n",
    })
    expect((await build(miniApp))?.entry).toBe('entry.js')
  })

  // Bun treats a module RESOLVED to the path `react` as the CommonJS package it usually is, and a
  // DEFAULT import of it (zustand's `import React from 'react'`) wrapped the ESM shim in a
  // CommonJS function that never set `exports`: the Git mini app's UI shipped, and on load threw
  // "createContext is not a function". Every way a bundle reaches React must reach the host's.
  test('every kind of React import reads the host React at runtime', async () => {
    const miniApp = fixtureMiniApp({
      'node_modules/store-hook/package.json': JSON.stringify({
        name: 'store-hook',
        type: 'module',
        sideEffects: false,
        exports: { '.': './index.mjs' },
      }),
      'node_modules/store-hook/index.mjs':
        "import React from 'react'\nexport const storeContext = () => React.createContext('store')\n",
      'node_modules/legacy-hook/package.json': '{"name":"legacy-hook","main":"index.js"}',
      'node_modules/legacy-hook/index.js':
        "'use strict'\nvar React = require('react')\nmodule.exports = () => React.createContext('legacy')\n",
      'ui/register.tsx': [
        "import React, { createContext } from 'react'",
        "import * as ReactNamespace from 'react'",
        "import { storeContext } from 'store-hook'",
        "import legacyContext from 'legacy-hook'",
        'export const contexts = () => [',
        "  React.createContext('default'),",
        "  createContext('named'),",
        "  ReactNamespace.createContext('namespace'),",
        '  storeContext(),',
        '  legacyContext(),',
        ']',
      ].join('\n'),
    })
    const out = join(tempDir(), 'out')
    await build(miniApp, out)

    const createContext = (value: string) => ({ context: value })
    const react = { createContext }
    const scope = globalThis as unknown as Record<string, unknown>
    scope.__LOCALIX_MINI_APP_UI_SHARED__ = {
      require: (specifier: string) => {
        if (specifier !== 'react') throw new Error(`unexpected ${specifier}`)
        return { ...react, default: react }
      },
      load: (specifier: string) => Promise.reject(new Error(`unexpected ${specifier}`)),
    }
    try {
      const entry = (await import(join(out, 'entry.js'))) as { contexts: () => unknown[] }
      expect(entry.contexts()).toEqual(
        ['default', 'named', 'namespace', 'store', 'legacy'].map((context) => ({ context })),
      )
    } finally {
      delete scope.__LOCALIX_MINI_APP_UI_SHARED__
    }
  })

  // The builder's resolve callbacks once matched every bare import and declined the ones they did
  // not serve. Bun drops a `sideEffects: false` re-export barrel resolved that way and still
  // reports success: `isTextItem` from `@localixai/agent/agents/items` shipped as an undeclared
  // `E_`, and every external-agents session import failed with "Can't find variable: E_".
  test('a bundled re-export barrel keeps the definitions it re-exports', async () => {
    const miniApp = fixtureMiniApp({
      'node_modules/lean-items/package.json': JSON.stringify({
        name: 'lean-items',
        type: 'module',
        sideEffects: false,
        exports: { './items': './items.js' },
      }),
      'node_modules/lean-items/items.js': "export { isText } from './model'\n",
      'node_modules/lean-items/model.js': "export const isText = (item) => item.kind === 'prose'\n",
      'ui/register.tsx': [
        "import { isText } from 'lean-items/items'",
        'export const prose = (items: { kind: string }[]) => items.filter(isText)',
        'export function registerUi() {}',
      ].join('\n'),
    })
    const out = join(tempDir(), 'out')
    await build(miniApp, out)
    expect(read(out, 'entry.js')).toContain('.kind==="prose"')
  })
})

describe('staging a mini app UI', () => {
  /** A repo with one mini app and a staged copy that already carries a built artifact. */
  function staged() {
    const repo = tempDir()
    write(join(repo, 'mini-apps', 'demo', 'ui', 'register.tsx'), 'export {}\n')
    const outMiniApps = join(tempDir(), 'plugins')
    write(join(outMiniApps, 'demo', 'dist', 'ui', 'manifest.json'), '{"revision":"old"}')
    return { repo, outMiniApps, artifact: join(outMiniApps, 'demo', 'dist', 'ui') }
  }
  const logs: string[] = []
  const log = (line: string) => logs.push(line)

  test('builds against the kit staged beside the mini apps', () => {
    const { repo, outMiniApps } = staged()
    const calls: string[][] = []
    stageMiniAppUi('demo', {
      repoRoot: repo,
      outMiniApps,
      log,
      onMiniAppError: 'skip',
      run: ((_command: string, args: string[]) => calls.push(args)) as never,
    })
    expect(calls[0]?.[3]).toBe(join(dirname(outMiniApps), 'mini-app-kit'))
    expect(calls[0]).not.toContain(NO_SOURCE_MAPS_FLAG)
  })

  test('release staging asks the builder for an artifact without source maps', () => {
    const { repo, outMiniApps } = staged()
    const calls: string[][] = []
    stageMiniAppUi('demo', {
      repoRoot: repo,
      outMiniApps,
      log,
      onMiniAppError: 'fatal',
      uiSourceMaps: false,
      run: ((_command: string, args: string[]) => calls.push(args)) as never,
    })
    expect(calls[0]).toContain(NO_SOURCE_MAPS_FLAG)
  })

  test('a failed build mid-edit keeps the UI that last built; the mini app stays', () => {
    const { repo, outMiniApps, artifact } = staged()
    const previous = takeStagedUiArtifact(join(outMiniApps, 'demo'))
    expect(existsSync(artifact)).toBe(false)
    const failure = stageMiniAppUi('demo', {
      repoRoot: repo,
      outMiniApps,
      log,
      onMiniAppError: 'skip',
      previous,
      run: (() => {
        throw new Error('syntax error in Panel.tsx')
      }) as never,
    })
    expect(failure).toMatchObject({ name: 'demo', reason: 'syntax error in Panel.tsx' })
    expect(read(artifact, 'manifest.json')).toBe('{"revision":"old"}')
    expect(existsSync(dirname(previous!))).toBe(false)
  })

  test('a successful build replaces the artifact and drops the one set aside', () => {
    const { repo, outMiniApps, artifact } = staged()
    const previous = takeStagedUiArtifact(join(outMiniApps, 'demo'))
    const failure = stageMiniAppUi('demo', {
      repoRoot: repo,
      outMiniApps,
      log,
      onMiniAppError: 'skip',
      previous,
      run: ((_command: string, args: string[]) =>
        write(join(args[2]!, 'manifest.json'), '{"revision":"new"}')) as never,
    })
    expect(failure).toBeNull()
    expect(read(artifact, 'manifest.json')).toBe('{"revision":"new"}')
    expect(existsSync(dirname(previous!))).toBe(false)
  })

  test('a successful restage keeps the previous lazy chunks for an open tab', () => {
    const { repo, outMiniApps, artifact } = staged()
    write(join(artifact, 'chunks', 'panel-old.js'), 'export const Panel = "old"\n')
    write(join(artifact, '.current-files.json'), '["chunks/panel-old.js"]\n')
    write(
      join(repo, 'mini-apps', 'demo', 'ui', 'register.tsx'),
      'export const lazyPanel = () => import("./Panel")\n',
    )
    write(join(repo, 'mini-apps', 'demo', 'ui', 'Panel.tsx'), 'export const Panel = "new"\n')
    const runUiBuild = (command: string, args: string[]) =>
      execFileSync(command, [...args.slice(0, 3), kit.dir], {
        stdio: 'pipe',
        timeout: 30_000,
        killSignal: 'SIGKILL',
      })
    const previous = takeStagedUiArtifact(join(outMiniApps, 'demo'))
    const failure = stageMiniAppUi('demo', {
      repoRoot: repo,
      outMiniApps,
      log,
      onMiniAppError: 'skip',
      previous,
      run: runUiBuild as never,
    })
    expect(failure).toBeNull()
    expect(read(artifact, 'chunks/panel-old.js')).toBe('export const Panel = "old"\n')
    expect(JSON.parse(read(artifact, 'manifest.json')).revision).not.toBe('old')
    expect(JSON.parse(read(artifact, '.current-files.json'))).not.toContain('chunks/panel-old.js')
    expect(existsSync(dirname(previous!))).toBe(false)

    const revision = JSON.parse(read(artifact, 'manifest.json')).revision
    for (let attempt = 0; attempt < 2; attempt++) {
      const kept = takeStagedUiArtifact(join(outMiniApps, 'demo'))
      expect(
        stageMiniAppUi('demo', {
          repoRoot: repo,
          outMiniApps,
          log,
          onMiniAppError: 'skip',
          previous: kept,
          run: runUiBuild as never,
        }),
      ).toBeNull()
      expect(JSON.parse(read(artifact, 'manifest.json')).revision).toBe(revision)
      expect(read(artifact, 'chunks/panel-old.js')).toBe('export const Panel = "old"\n')
      expect(existsSync(dirname(kept!))).toBe(false)
    }
  })

  test('release staging (fatal) stops on a failed UI build', () => {
    const { repo, outMiniApps } = staged()
    expect(() =>
      stageMiniAppUi('demo', {
        repoRoot: repo,
        outMiniApps,
        log,
        onMiniAppError: 'fatal',
        run: (() => {
          throw new Error('broken')
        }) as never,
      }),
    ).toThrow('broken')
  })
})

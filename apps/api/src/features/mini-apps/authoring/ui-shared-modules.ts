import { join, relative } from 'node:path'

import {
  MINI_APP_UI_PRELOADED_MODULES,
  MINI_APP_UI_SHARED_GLOBAL,
  MINI_APP_UI_SHARED_MODULE,
} from '@localixai/mini-app-sdk/ui-artifact'

import { escapeRegExp } from '../../../lib/regexp'
import type { MiniAppKit } from './kit'
import { MINI_APP_UI_PREBUILT_MODULES } from './kit-layout'

/**
 * How a mini app's UI build resolves what it does not bundle (`ui-build.ts`): each import of a
 * shared module (`MINI_APP_UI_SHARED_MODULE`) becomes a tiny module that takes the host's instance
 * and re-exports exactly the names the kit recorded for it, the kit's vendor and prebuilt modules
 * come from the kit, and host internals fail the build.
 */

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/u
const SHARED_NAMESPACE = 'localix-shared'

/**
 * The module standing in for one shared import. A module the host loads before any artifact
 * (React) is read synchronously; anything else is awaited, so it loads with the chunk that uses
 * it. The split is not cosmetic: an older CommonJS dependency `require`s React, and Bun refuses a
 * `require` whose dependency chain contains a top-level `await` anywhere.
 *
 * The preloaded shims are CommonJS (`module.exports`), not ESM. Bun treats a module resolved to
 * `react` (or `react-dom`, `react/jsx-runtime`) as the CommonJS package it usually is: a DEFAULT
 * import of it — zustand's `import React from 'react'` — wrapped an ESM shim in a CommonJS
 * function that kept its `export const { … }` as locals and exported nothing, so the Git mini
 * app's UI loaded React from an empty object ("createContext is not a function"). A CommonJS shim
 * is what Bun expects there, and it serves a default, named, namespace or `require` import alike.
 * `__esModule` keeps a default import the host's `default`, as the ESM shim gave it; the build
 * fails on a shim that lost its exports anyway (`assertSharedShimsExported`).
 *
 * The awaited `load` is the ONLY top-level `await` an artifact carries, and it is safe only because
 * the host's registry never settles a load after `pagehide`
 * (`apps/ui/src/app/miniAppSharedModules.ts`): WebKit resumes a module paused at a top-level
 * `await` in a detached document by spinning forever, which froze the whole app after a reload. A
 * second kind of top-level `await` here would reopen it.
 */
export function sharedShim(specifier: string, names: readonly string[]): string {
  const named = [...new Set(names)].filter((name) => name !== 'default' && IDENTIFIER.test(name))
  const host = `globalThis[${JSON.stringify(MINI_APP_UI_SHARED_GLOBAL)}]`
  const id = JSON.stringify(specifier)
  if (MINI_APP_UI_PRELOADED_MODULES.includes(specifier)) {
    const fields = ['__esModule: true', 'default: m.default', ...named.map((n) => `${n}: m.${n}`)]
    return [`const m = ${host}.require(${id})`, `module.exports = { ${fields.join(', ')} }`].join(
      '\n',
    )
  }
  return [
    `const m = await ${host}.load(${id})`,
    named.length ? `export const { ${named.join(', ')} } = m` : '',
    'export default m.default',
  ].join('\n')
}

/** Bare specifiers the build takes from the kit: vendor packages and the prebuilt portable modules. */
function kitBundledModules(kit: MiniAppKit): Record<string, string> {
  const prebuilt = MINI_APP_UI_PREBUILT_MODULES.flatMap((specifier) => {
    const file = kit.manifest.backendModules[specifier]
    return file ? [[specifier, file] as const] : []
  })
  return { ...Object.fromEntries(prebuilt), ...kit.manifest.uiVendorModules }
}

/** A filter matching exactly `specifiers`, and nothing that merely starts like one. */
function exactly(specifiers: readonly string[]): RegExp {
  const escaped = specifiers.map(escapeRegExp)
  return new RegExp(`^(?:${escaped.join('|')})$`, 'u')
}

/**
 * Every callback here CLAIMS each import its filter matches, or fails the build; none matches an
 * import only to decline it. Declining is not neutral in Bun 1.3: a re-export barrel of a
 * `sideEffects: false` package, resolved after a callback declined it, is dropped — and the build
 * still succeeds, the barrel's names referenced and their definitions gone. That is how
 * `isTextItem` from `@localixai/agent/agents/items` shipped as an undeclared `E_`, on which a
 * bundled mini app's every session import failed. So each filter names exactly its modules, and
 * every other import meets Bun's own resolver, browser conditions and all, with no mini app in the
 * way.
 */
export function sharedModulesPlugin(kit: MiniAppKit, miniAppDir: string): Bun.BunPlugin {
  const vendor = kitBundledModules(kit)
  const vendored = Object.keys(vendor)
  return {
    name: 'localix-mini-app-ui-shared',
    setup(build) {
      // The boundary, enforced where it matters: host internals are never bundled into a mini app.
      // (Bun's onResolve ignores esbuild-style returned `errors`; throwing fails the build.)
      build.onResolve({ filter: /^@\// }, (args) => {
        throw new Error(
          `${relative(miniAppDir, args.importer)} imports host internals ("${args.path}"); use a @localixai/kit module`,
        )
      })
      build.onResolve({ filter: MINI_APP_UI_SHARED_MODULE }, (args) => {
        if (!kit.manifest.uiSharedExports[args.path]) {
          throw new Error(
            `${relative(miniAppDir, args.importer)}: the host provides no "${args.path}"`,
          )
        }
        return { path: args.path, namespace: SHARED_NAMESPACE }
      })
      if (vendored.length > 0) {
        build.onResolve({ filter: exactly(vendored) }, (args) => ({
          path: join(kit.dir, vendor[args.path]!),
        }))
      }
      build.onLoad({ filter: /.*/u, namespace: SHARED_NAMESPACE }, (args) => ({
        loader: 'js',
        contents: sharedShim(args.path, kit.manifest.uiSharedExports[args.path] ?? []),
      }))
    },
  }
}

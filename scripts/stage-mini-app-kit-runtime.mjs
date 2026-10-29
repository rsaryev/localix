// The mini app kit's RUNTIME: prebuilt copies of every module a mini app's backend, UI and tests
// import from the host, as ONE split build — so the `react` a kit button renders with, the `react` a
// test mounts with and the `zod` inside the SDK are each one module, as they are in the host.
//
// A backend build reads `backendModules` (the modules the host hands a backend at runtime). A
// mini app's TESTS read everything through the kit's test preload, which answers each shared
// specifier with its prebuilt file: the kit doors and the modules the host lends, the SDK's UI
// entries, React, and the host's test harness (`@localixai/kit/testing*`). That is what lets a mini
// app outside this repository — its own repository, a marketplace — run its DOM tests with the kit
// as its only dependency.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import {
  MINI_APP_BACKEND_HOST_MODULES,
  MINI_APP_BACKEND_SHARED_MODULES,
  MINI_APP_KIT_BACKEND_DIR,
  MINI_APP_KIT_TEST_PRELOAD,
  MINI_APP_TEST_EXTRA_MODULES,
  MINI_APP_UI_VENDOR_PACKAGES,
} from '@localixai/api/mini-app-kit-layout'

import { reactTimers, viteQueries } from './stage-mini-app-kit-plugins.mjs'

/** Where the modules a mini app bundles itself are staged, kit-relative. */
export const MINI_APP_KIT_BUNDLED_DIR = 'bundled'

/** React DOM's server renderer: tests render markup with it, through the kit's one React. */
const REACT_EXTRAS = ['react-dom/server']

/** The host's test harness for mini apps, served as `@localixai/kit/testing*`. */
export const KIT_TESTING_MODULES = {
  '@localixai/kit/testing': 'apps/ui/src/app/kit/testing/index.ts',
  '@localixai/kit/testing/lent-components': 'apps/ui/src/app/kit/testing/lent-components.ts',
  '@localixai/kit/testing/host-runtime': 'apps/ui/src/app/kit/testing/host-runtime.ts',
  '@localixai/kit/testing/dom': 'packages/kit/src/testing/dom.ts',
  // The host's checks of a context provider's contributions (latency, size, shape).
  '@localixai/kit/testing/context-contract':
    'apps/api/src/features/context-fabric/testing/mini-app-contract-kit.ts',
}

/**
 * Packages a mini app's UI bundles itself (they are not host-shared) but that live in this
 * repository, so a mini app elsewhere cannot install them: its tests get the kit's copy.
 */
const KIT_BUNDLED_PACKAGES = ['@localixai/dataview']

/**
 * Radix decides its layout-effect hook once, when it is first evaluated (`packages/kit/
 * test-preload.ts` explains the failure). The preload evaluates this entry with a DOM present.
 */
const RADIX = 'radix-ui'

/** A file name for a specifier's entry (`@localixai/kit/button` → `localixai-kit-button`). */
const entryId = (specifier) => specifier.replace(/[^a-z0-9]+/giu, '-').replace(/^-/u, '')

/**
 * Every module the runtime serves: `[specifier, import target, has a default export]`. The UI's
 * shared modules come with their export names already read (`uiSharedExports`), so a module with
 * a default export keeps it (`export *` alone drops it).
 */
function runtimeModules(repoRoot, uiSharedExports, reactExtras) {
  const modules = new Map()
  const add = (specifier, target, hasDefault = false) => {
    if (!modules.has(specifier)) modules.set(specifier, { target, hasDefault, names: null })
  }
  // React ships CommonJS: `export *` of it names nothing a test can import (`jsxDEV`), so its
  // entries name every export, read from the module the host hands over.
  for (const [specifier, names] of Object.entries({ ...uiSharedExports, ...reactExtras })) {
    if (/^react(?:-dom)?(?:\/|$)/u.test(specifier))
      modules.set(specifier, { target: specifier, hasDefault: true, names })
  }
  for (const specifier of [...MINI_APP_BACKEND_SHARED_MODULES, ...MINI_APP_TEST_EXTRA_MODULES])
    add(specifier, specifier, /^react(?:-dom)?$/u.test(specifier))
  for (const [specifier, names] of Object.entries(uiSharedExports)) {
    const target = specifier.startsWith('@localixai/kit/')
      ? kitTarget(repoRoot, specifier)
      : specifier
    add(specifier, target, names.includes('default'))
  }
  for (const [specifier, file] of Object.entries(KIT_TESTING_MODULES))
    add(specifier, join(repoRoot, file))
  for (const specifier of [...sdkSpecifiers(repoRoot), ...KIT_BUNDLED_PACKAGES])
    add(specifier, specifier)
  for (const specifier of MINI_APP_UI_VENDOR_PACKAGES) add(specifier, specifier)
  add(RADIX, RADIX)
  return modules
}

/** Every subpath the SDK exports, as the specifier a mini app imports. */
function sdkSpecifiers(repoRoot) {
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, 'packages/mini-app-sdk/package.json'), 'utf8'),
  )
  return Object.keys(manifest.exports ?? {})
    .filter((subpath) => subpath !== '.' && !subpath.includes('*'))
    .map((subpath) => `@localixai/mini-app-sdk/${subpath.slice(2)}`)
}

/** The export names of React's CommonJS modules the host does not already list. */
async function reactExtraExports(repoRoot) {
  const from = join(repoRoot, 'apps/ui')
  const entries = await Promise.all(
    REACT_EXTRAS.map(async (specifier) => [
      specifier,
      Object.keys(await import(Bun.resolveSync(specifier, from))),
    ]),
  )
  return Object.fromEntries(entries)
}

/** An entry re-exporting one module, its default included when it has one. */
function entrySource({ target, hasDefault, names }) {
  if (names) {
    const named = names.filter((name) => name !== 'default')
    return `import mod from '${target}'\nexport const { ${named.join(', ')} } = mod\nexport default mod\n`
  }
  const reexport = `export * from '${target}'\n`
  return hasDefault ? `${reexport}export { default } from '${target}'\n` : reexport
}

/** Kit doors resolve through the package; a module the host lends is read from its file. */
function kitTarget(repoRoot, specifier) {
  const id = specifier.slice('@localixai/kit/'.length)
  const lent = join(repoRoot, 'apps/ui/src/app/kit', `${id}.ts`)
  return existsSync(lent) ? lent : join(repoRoot, 'packages/kit/src/entries', `${id}.ts`)
}

/**
 * Build the runtime into `<outKit>/backend` and write its test preload. Returns the backend
 * modules (specifier → kit-relative file), as the kit manifest records them.
 */
export async function buildKitRuntime({ repoRoot, outDir, uiSharedExports }) {
  const modules = runtimeModules(repoRoot, uiSharedExports, await reactExtraExports(repoRoot))
  mkdirSync(join(repoRoot, '.turbo'), { recursive: true })
  // Entries are generated inside the repository so they resolve its packages.
  const scratch = mkdtempSync(join(repoRoot, '.turbo', 'mini-app-kit-'))
  try {
    const entries = [...modules].map(([specifier, module]) => {
      const file = join(scratch, `${entryId(specifier)}.mjs`)
      writeFileSync(file, entrySource(module))
      // The bundler names every output `.js`; the folder's package.json marks them ES modules.
      return { specifier, file, output: `${entryId(specifier)}.js` }
    })
    const result = await Bun.build({
      entrypoints: entries.map((entry) => entry.file),
      outdir: outDir,
      root: scratch,
      target: 'bun',
      format: 'esm',
      splitting: true,
      plugins: [viteQueries, reactTimers],
      naming: {
        entry: '[name].[ext]',
        chunk: 'chunks/[name]-[hash].[ext]',
        asset: 'assets/[name]-[hash].[ext]',
      },
    })
    if (!result.success) throw new Error(result.logs.map(String).join('\n'))
    const files = Object.fromEntries(entries.map(({ specifier, output }) => [specifier, output]))
    const defaults = [...modules].filter(([, module]) => module.hasDefault).map(([name]) => name)
    writeFileSync(join(outDir, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`)
    writeFileSync(join(outDir, basename(MINI_APP_KIT_TEST_PRELOAD)), testPreload(files, defaults))
    const backend = [...MINI_APP_BACKEND_SHARED_MODULES, ...MINI_APP_TEST_EXTRA_MODULES]
    return Object.fromEntries(
      backend.map((specifier) => [specifier, `${MINI_APP_KIT_BACKEND_DIR}/${files[specifier]}`]),
    )
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/**
 * The modules a mini app's build bundles INTO the app: the SDK subpaths and repository packages the
 * host does not hand over at runtime to a side that uses them (`agent-wait` to a backend, the data
 * views to either). A mini app elsewhere cannot install them, so the kit carries each as one file
 * whose host-shared imports (React, zod, the SDK the host serves) stay imports — bundling them
 * would put a second React in the app.
 * Returns specifier → kit-relative file, as kit.json's `bundledModules` records it.
 */
export async function buildBundledModules({ repoRoot, outDir, uiSharedExports }) {
  const ui = new Set(Object.keys(uiSharedExports))
  const backend = new Set(MINI_APP_BACKEND_HOST_MODULES)
  // A module either side lacks: the UI build takes the host's copy where it has one, and bundles
  // this file where it does not; the backend build likewise.
  const served = (specifier) => {
    if (/^@localixai\/mini-app-sdk\/ui(?:\/|$)/u.test(specifier)) return ui.has(specifier)
    if (/^@localixai\/mini-app-sdk\/backend(?:\/|$)/u.test(specifier)) return backend.has(specifier)
    return ui.has(specifier) && backend.has(specifier)
  }
  const bundled = [...sdkSpecifiers(repoRoot), ...KIT_BUNDLED_PACKAGES].filter(
    (specifier) => !served(specifier) && !specifier.endsWith('/testing'),
  )
  // Its own imports stay imports, resolved again by the build that bundles it.
  const external = [
    ...new Set([...ui, ...backend, ...MINI_APP_UI_VENDOR_PACKAGES, ...bundled]),
    'react',
    'react/*',
    'react-dom',
    'react-dom/*',
  ]
  mkdirSync(outDir, { recursive: true })
  const out = {}
  // One build per module, held in memory: each is one self-contained file named by its specifier.
  for (const specifier of bundled) {
    const result = await Bun.build({
      entrypoints: [Bun.resolveSync(specifier, join(repoRoot, 'apps/ui'))],
      target: 'bun',
      format: 'esm',
      external: external.filter((name) => name !== specifier),
      plugins: [viteQueries],
      throw: false,
    })
    if (!result.success) throw new Error(result.logs.map(String).join('\n'))
    const file = `${entryId(specifier)}.js`
    const entry = result.outputs.find((output) => output.kind === 'entry-point')
    writeFileSync(join(outDir, file), await entry.text())
    out[specifier] = `${MINI_APP_KIT_BUNDLED_DIR}/${file}`
  }
  return out
}

/**
 * The test preload: each shared specifier is a virtual module re-exporting the kit's file, so the
 * file loads when a test first imports it (Monaco behind the code editor costs nothing to a test
 * that never opens one). Bun applies a runtime plugin's `onResolve` to relative paths only; a bare
 * specifier needs `build.module`.
 */
function testPreload(files, defaults) {
  return `// Generated by scripts/stage-mini-app-kit-runtime.mjs. A mini app outside the Localix repository
// has no Localix packages installed: its tests get every shared module from the kit, the same
// copies the host runs, one instance each.
import { plugin } from 'bun'

// React's test bundle (it carries \`act\`), whatever the caller's environment says.
process.env.NODE_ENV = 'test'

const files = ${JSON.stringify(files, null, 2)}
const withDefault = new Set(${JSON.stringify(defaults)})

plugin({
  name: 'localix-mini-app-kit',
  setup(build) {
    for (const [specifier, file] of Object.entries(files)) {
      const path = JSON.stringify(new URL(file, import.meta.url).pathname)
      const contents = withDefault.has(specifier)
        ? \`export * from \${path}\\nexport { default } from \${path}\\n\`
        : \`export * from \${path}\\n\`
      build.module(specifier, () => ({ loader: 'js', contents }))
    }
  },
})

// Radix binds its layout-effect hook on first evaluation: evaluate it with a DOM present, then
// leave the process as it was (a DOM test registers its own through @localixai/kit/testing).
const { registerDom } = await import(${JSON.stringify(`./${files['@localixai/kit/testing/dom']}`)})
const release = registerDom()
try {
  await import(${JSON.stringify(`./${files[RADIX]}`)})
} finally {
  await release()
}
`
}

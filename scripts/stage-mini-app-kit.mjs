// Stage the MINI APP KIT beside the staged mini apps: everything the running app needs to scaffold,
// build and test a user mini app without a source tree (layout: apps/api/src/features/mini-apps/
// kit-layout.ts). The authoring plugin reads it; Localix serves it at `/rpc/mini-apps/kit`.
//
// Why at staging: an installed app has no `node_modules`, no host sources and no scanner binaries,
// so whatever a user mini app build needs from the host is resolved HERE, once, where it all exists
// — the export names of every module the host shares with mini app UI, the host
// theme's stylesheets, and prebuilt copies of the modules a mini app backend may import — and the
// app reads only the result. Development stages the same kit, so there is one path, not a dev
// shortcut.
//
// Run as a child (`bun scripts/stage-mini-app-kit.mjs <repoRoot> <outKit>`), so staging's
// synchronous pipeline stays synchronous while this uses the async bundler.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { parseSync } from 'oxc-parser'
import { cachedKit, kitInputsDigest, storeKit } from './mini-app-kit-cache.mjs'

import {
  MINI_APP_BACKEND_SHARED_MODULES,
  MINI_APP_KIT_BACKEND_DIR,
  MINI_APP_KIT_CATALOG,
  MINI_APP_KIT_MANIFEST,
  MINI_APP_KIT_SCHEMA_VERSION,
  MINI_APP_KIT_STYLES_DIR,
  MINI_APP_KIT_TEST_PRELOAD,
  MINI_APP_KIT_TYPECHECK,
  MINI_APP_KIT_UI_VENDOR_DIR,
  MINI_APP_UI_PREBUILT_MODULES,
  MINI_APP_UI_VENDOR_PACKAGES,
  TAILWIND_UTILITIES,
} from '@localixai/api/mini-app-kit-layout'
import { MINI_APP_API_VERSION } from '@localixai/mini-app-sdk/manifest-primitives'
import { MINI_APP_UI_KIT_PREFIX } from '@localixai/mini-app-sdk/ui-artifact'

import {
  buildBundledModules,
  buildKitRuntime,
  MINI_APP_KIT_BUNDLED_DIR,
} from './stage-mini-app-kit-runtime.mjs'
import { stageHostStylesheets } from './stage-mini-app-kit-styles.mjs'
import {
  buildKitTools,
  KIT_AUTHORING_VERSION,
  KIT_TOOLS_INPUTS,
  localixVersion,
} from './stage-mini-app-kit-tools.mjs'
import { stageMiniAppKitTypes } from './stage-mini-app-kit-types.mjs'

/** The host's design-system stylesheet: its theme, variants and utilities. */
export const HOST_STYLESHEET = 'apps/ui/src/app/index.css'
/**
 * Where `@localixai/kit/<id>` comes from, in resolution order: a door of the kit package, then a
 * module the host lends because it is bound to a host feature. The registry
 * (`apps/ui/src/app/miniAppSharedModules.ts`) globs the same two directories, and its test pins
 * that no id is in both.
 */
export const KIT_DOORS_DIR = 'packages/kit/src/entries'
export const HOST_KIT_DIR = 'apps/ui/src/app/kit'
const KIT_MODULE_DIRS = [KIT_DOORS_DIR, HOST_KIT_DIR]
/** The host's registry of shared UI modules; its keys are what a mini app may import. */
const HOST_SHARED_MODULES = 'apps/ui/src/app/miniAppSharedModules.ts'

/**
 * Everything the kit is made from, repository-relative: a change to any of these is a stale kit.
 * One list, read by the dev watcher (re-stage while the API runs) and by packaging (its cache
 * key), so the two cannot disagree about when a kit is current.
 */
export const MINI_APP_KIT_INPUTS = [
  'scripts/stage-mini-app-kit.mjs',
  'scripts/stage-mini-app-kit-styles.mjs',
  'scripts/stage-mini-app-kit-types.mjs',
  'scripts/stage-mini-app-kit-declarations.mjs',
  'scripts/stage-mini-app-kit-runtime.mjs',
  'scripts/stage-mini-app-kit-plugins.mjs',
  'scripts/mini-app-kit-cache.mjs',
  'apps/api/src/features/mini-apps/kit-layout.ts',
  // The context contract a mini app's provider tests certify against (`@localixai/kit/testing/*`).
  'apps/api/src/features/context-fabric',
  ...KIT_TOOLS_INPUTS,
  // The kit runtime bundles the modules the host lends and the host test harness, which reach
  // into the whole UI source tree.
  'apps/ui/src',
  // The kit's component declarations are read from its primitives, its tokens from its styles.
  'packages/kit/src',
  'packages/kit/styles',
  'packages/mini-app-sdk/dist',
  // Declarations the SDK's own declarations import (`stage-mini-app-kit-types.mjs`).
  'packages/agent/dist',
  'packages/dataview/dist',
  'packages/search/dist',
  'packages/uri/dist',
]

/** Value exports of an ES module, following its `export *` chains (relative or a package). */
function esmExportNames(file, seen = new Set()) {
  if (seen.has(file)) return []
  seen.add(file)
  const { module } = parseSync(file, readFileSync(file, 'utf8'))
  const names = []
  for (const entry of module.staticExports.flatMap((statement) => statement.entries)) {
    if (entry.isType) continue
    if (entry.exportName.kind === 'Name') names.push(entry.exportName.name)
    else if (entry.exportName.kind === 'Default') names.push('default')
    else if (entry.moduleRequest && entry.importName.kind === 'AllButDefault') {
      // The resolver, not path arithmetic: emitted specifiers are often extensionless.
      const target = Bun.resolveSync(entry.moduleRequest.value, dirname(file))
      names.push(...esmExportNames(target, seen).filter((name) => name !== 'default'))
    }
  }
  return names
}

/** The names a shared module exports, read from the module the HOST hands over. */
export async function sharedExportNames(specifier, { repoRoot }) {
  if (specifier.startsWith(MINI_APP_UI_KIT_PREFIX)) {
    const file = kitModuleFile(repoRoot, specifier.slice(MINI_APP_UI_KIT_PREFIX.length))
    if (!file) throw new Error(`${specifier}: no such kit module`)
    return esmExportNames(file)
  }
  const resolved = Bun.resolveSync(specifier, repoRoot)
  // The SDK ships ES modules: read them statically. React ships CommonJS: ask the module.
  if (/\.m?js$/u.test(resolved) && readFileSync(resolved, 'utf8').includes('export ')) {
    return esmExportNames(resolved)
  }
  return Object.keys(await import(resolved)).filter((name) => name !== '__esModule')
}

/** The file behind `@localixai/kit/<id>`: the package's door first, then the host's lent module. */
export function kitModuleFile(repoRoot, id) {
  for (const dir of KIT_MODULE_DIRS) {
    const file = join(repoRoot, dir, `${id}.ts`)
    if (existsSync(file)) return file
  }
  return null
}

export function kitModuleIds(repoRoot) {
  const ids = KIT_MODULE_DIRS.flatMap((dir) =>
    readdirSync(join(repoRoot, dir))
      .filter((file) => file.endsWith('.ts'))
      .map((file) => file.slice(0, -3)),
  )
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b))
}

async function uiSharedExports(repoRoot) {
  const { HOST_SHARED_SPECIFIERS } = await import(join(repoRoot, HOST_SHARED_MODULES))
  const specifiers = [
    ...HOST_SHARED_SPECIFIERS,
    ...kitModuleIds(repoRoot).map((id) => `${MINI_APP_UI_KIT_PREFIX}${id}`),
  ]
  const entries = []
  for (const specifier of specifiers)
    entries.push([specifier, await sharedExportNames(specifier, { repoRoot })])
  return Object.fromEntries(entries)
}

/** Each vendor package's ES module tree, source maps dropped. */
function stageVendorPackages(repoRoot, outDir) {
  const modules = {}
  for (const name of MINI_APP_UI_VENDOR_PACKAGES) {
    const manifestPath = Bun.resolveSync(`${name}/package.json`, join(repoRoot, KIT_DOORS_DIR))
    const root = dirname(manifestPath)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (typeof manifest.module !== 'string') throw new Error(`${name} ships no ES module entry`)
    const target = join(outDir, name)
    // Some ES trees keep helpers beside src/ (media codecs, for example). Copy that portable
    // module tree as well, rather than publishing an entry whose relative imports are missing.
    const moduleDir = dirname(manifest.module)
    const moduleTree = basename(moduleDir) === 'src' ? dirname(moduleDir) : moduleDir
    cpSync(join(root, moduleTree), join(target, moduleTree), {
      recursive: true,
      filter: (src) => !src.endsWith('.map'),
    })
    writeFileSync(
      join(target, 'package.json'),
      `${JSON.stringify({ name, version: manifest.version, type: 'module', sideEffects: false, browser: manifest.browser }, null, 2)}\n`,
    )
    modules[name] = join(MINI_APP_KIT_UI_VENDOR_DIR, name, manifest.module).split(sep).join('/')
  }
  return modules
}

/**
 * `KIT.md`: the kit catalog a mini app author chooses from, by job. The catalog lives in the kit
 * package (`packages/kit/src/catalog`), pinned to its doors by tests; this renders it once, here,
 * because an installed app has no package sources to read it from.
 */
async function stageKitCatalog(repoRoot, outKit) {
  const { renderKitCatalog } = await import(join(repoRoot, 'packages/kit/src/catalog/index.ts'))
  const intro = [
    '# The Localix UI kit',
    '',
    'Generated by Localix from the kit it ships; edits are overwritten on the next build.',
    '',
    'Every control, overlay, row and state a mini app view needs is one of these modules. Find the',
    'job in the tables, import the module, and read its props in the editor (the types are real).',
    'Build nothing the kit has: a hand-made button, tab row, checkbox, tree indent, progress bar or',
    'empty state drifts from the rest of the app and fails the house style.',
    '',
    'Colour with tokens (`text-text-soft`, `text-text-faint`, `border-border`, `bg-surface-hover`,',
    '`text-status-error|warning|success|info`, `--chart-N`), never a palette class or a hex value.',
    'Heights come from the control ladder (`xs` 20 · `sm` 24 · `md` 28 · `lg` 32 · `xl` 36 px), the',
    'same name on every primitive. Tones: an ACTION is `default` or `danger`; a STATUS is `neutral`,',
    '`info`, `success`, `warning` or `error`.',
    '',
  ].join('\n')
  writeFileSync(join(outKit, MINI_APP_KIT_CATALOG), `${intro}\n${renderKitCatalog()}`)
  return MINI_APP_KIT_CATALOG
}

/**
 * The kit as a package: a mini app repository depends on `@localixai/mini-app-kit` — a release's
 * tarball, or a staged folder linked with `bun link` — at the Localix version it targets.
 */
function kitPackage(manifest) {
  return {
    name: '@localixai/mini-app-kit',
    version: manifest.localixVersion,
    description: 'What a Localix mini app is type-checked, tested and built against.',
    license: 'MIT',
    type: 'module',
    // `./test-preload` lets a mini app's bunfig preload the kit by name, before its own setup.
    exports: {
      './kit.json': './kit.json',
      './package.json': './package.json',
      './test-preload': `./${MINI_APP_KIT_TEST_PRELOAD}`,
    },
  }
}

export async function stageMiniAppKit({ repoRoot, outKit, log = () => {} }) {
  rmSync(outKit, { recursive: true, force: true })
  mkdirSync(outKit, { recursive: true })
  const stylesDir = join(outKit, MINI_APP_KIT_STYLES_DIR)
  const hostStylesheet = stageHostStylesheets({
    entry: join(repoRoot, HOST_STYLESHEET),
    outDir: stylesDir,
    packages: [TAILWIND_UTILITIES.replace(/\.css$/u, '')],
  })
  const shared = await uiSharedExports(repoRoot)
  const types = stageMiniAppKitTypes({
    repoRoot,
    outKit,
    uiSharedExports: shared,
    sdkDir: join(repoRoot, 'packages', 'mini-app-sdk'),
    kitDirs: KIT_MODULE_DIRS.map((dir) => join(repoRoot, dir)),
  })
  const manifest = {
    schemaVersion: MINI_APP_KIT_SCHEMA_VERSION,
    kitModules: kitModuleIds(repoRoot),
    kitDigest: types.kitDigest,
    kitCatalog: await stageKitCatalog(repoRoot, outKit),
    uiSharedExports: shared,
    typePaths: types.typePaths,
    typescript: types.typescript,
    hostStylesheet: join(MINI_APP_KIT_STYLES_DIR, hostStylesheet).split(sep).join('/'),
    backendModules: await buildKitRuntime({
      repoRoot,
      outDir: join(outKit, MINI_APP_KIT_BACKEND_DIR),
      uiSharedExports: shared,
    }),
    uiVendorModules: stageVendorPackages(repoRoot, join(outKit, MINI_APP_KIT_UI_VENDOR_DIR)),
    bundledModules: await buildBundledModules({
      repoRoot,
      outDir: join(outKit, MINI_APP_KIT_BUNDLED_DIR),
      uiSharedExports: shared,
    }),
  }
  // What the authoring plugin reads (`stage-mini-app-kit-tools.mjs`): every path
  // kit-relative, so the kit works wherever it is unpacked.
  manifest.apiVersion = MINI_APP_API_VERSION
  manifest.localixVersion = localixVersion(repoRoot)
  manifest.authoring = {
    version: KIT_AUTHORING_VERSION,
    catalog: manifest.kitCatalog,
    styles: MINI_APP_KIT_STYLES_DIR,
    tailwindUtilities: join(MINI_APP_KIT_STYLES_DIR, TAILWIND_UTILITIES).split(sep).join('/'),
    typecheck: MINI_APP_KIT_TYPECHECK,
    typeRoots: 'types/node_modules/@types',
    ambientTypes: types.ambientTypes,
    testPreload: MINI_APP_KIT_TEST_PRELOAD,
    backendSharedModules: [...MINI_APP_BACKEND_SHARED_MODULES],
    uiPrebuiltModules: [...MINI_APP_UI_PREBUILT_MODULES],
    tools: await buildKitTools(repoRoot, outKit),
  }
  writeFileSync(join(outKit, MINI_APP_KIT_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(outKit, 'package.json'), `${JSON.stringify(kitPackage(manifest), null, 2)}\n`)
  if (types.kitRejected.length) {
    log(
      `kit modules declared by name only (their types did not compile): ${types.kitRejected.join(', ')}`,
    )
  }
  log('staged the mini app kit')
  return manifest
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.path)) {
  const args = process.argv.slice(2)
  const cacheRoot = args.find((arg) => arg.startsWith('--cache='))?.slice('--cache='.length)
  const [repoRoot, outKit] = args.filter((arg) => !arg.startsWith('--'))
  if (!repoRoot || !outKit) {
    console.error('Usage: bun scripts/stage-mini-app-kit.mjs <repoRoot> <outKit> [--cache=<dir>]')
    process.exit(2)
  }
  // Staged beside, then swapped in: a running API re-staged under (the dev watcher) must never
  // read half a kit.
  const target = resolve(outKit)
  const next = `${target}.next-${process.pid}`
  const root = resolve(repoRoot)
  const log = (line) => console.log(`[mini-app-kit] ${line}`)
  try {
    // Development only (`--cache`): reuse the kit staged for identical inputs. See
    // `mini-app-kit-cache.mjs` for why a kit is safe to reuse and why the key is content.
    // The version is part of the key: a release stamps its own into an otherwise identical kit.
    const key = () => `${kitInputsDigest(root, MINI_APP_KIT_INPUTS)}-${localixVersion(root)}`
    const digest = cacheRoot ? key() : null
    const hit = digest ? cachedKit(cacheRoot, digest, MINI_APP_KIT_MANIFEST) : null
    if (hit) {
      cpSync(hit, next, { recursive: true })
      log('reused the mini app kit')
    } else {
      await stageMiniAppKit({ repoRoot: root, outKit: next, log })
      // An input edited while staging ran makes this kit match neither digest; keep it uncached.
      if (digest && key() === digest) {
        storeKit(cacheRoot, digest, next)
      }
    }
    rmSync(target, { recursive: true, force: true })
    renameSync(next, target)
  } catch (error) {
    rmSync(next, { recursive: true, force: true })
    console.error(`[mini-app-kit] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

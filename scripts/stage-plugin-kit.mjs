// Stage the PLUGIN KIT beside the staged plugins: everything the running app needs to scaffold,
// build and test a user plugin without a source tree (layout: apps/api/src/features/plugins/
// authoring/kit-layout.ts).
//
// Why at staging: an installed app has no `node_modules`, no host sources and no scanner binaries,
// so whatever a user plugin build needs from the host is resolved HERE, once, where it all exists —
// the template, the export names of every module the host shares with plugin UI, the host theme's
// stylesheets, and prebuilt copies of the modules a plugin backend may import — and the app reads
// only the result. Development stages the same kit, so there is one path, not a dev shortcut.
//
// Run as a child (`bun scripts/stage-plugin-kit.mjs <repoRoot> <outKit>`), so staging's synchronous
// pipeline stays synchronous while this uses the async bundler.
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { parseSync } from 'oxc-parser'
import { cachedKit, kitInputsDigest, storeKit } from './plugin-kit-cache.mjs'
import { MINI_APPS_DIR, miniAppsRoot } from './lib/bundled-roots.mjs'

import {
  MINI_APP_BACKEND_SHARED_MODULES,
  PLUGIN_KIT_BACKEND_DIR,
  PLUGIN_KIT_CATALOG,
  PLUGIN_KIT_MANIFEST,
  PLUGIN_KIT_SCHEMA_VERSION,
  PLUGIN_KIT_STYLES_DIR,
  PLUGIN_KIT_TEMPLATE_DIR,
  PLUGIN_KIT_TEST_PRELOAD,
  PLUGIN_KIT_UI_VENDOR_DIR,
  MINI_APP_TEST_EXTRA_MODULES,
  MINI_APP_UI_VENDOR_PACKAGES,
  TAILWIND_UTILITIES,
  TEMPLATE_SCAFFOLD_FILE,
} from '@localixai/api/plugin-kit-layout'
import { MINI_APP_UI_KIT_PREFIX } from '@localixai/mini-app-sdk/ui-artifact'

import { stageHostStylesheets } from './stage-plugin-kit-styles.mjs'
import { stageMiniAppKitTypes } from './stage-plugin-kit-types.mjs'

/** The host's design-system stylesheet: its theme, variants and utilities. */
export const HOST_STYLESHEET = 'apps/ui/src/app/index.css'
/**
 * Where `@localixai/kit/<id>` comes from, in resolution order: a door of the kit package, then a
 * module the host lends because it is bound to a host feature. The registry
 * (`apps/ui/src/app/pluginSharedModules.ts`) globs the same two directories, and its test pins
 * that no id is in both.
 */
export const KIT_DOORS_DIR = 'packages/kit/src/entries'
export const HOST_KIT_DIR = 'apps/ui/src/app/kit'
const KIT_MODULE_DIRS = [KIT_DOORS_DIR, HOST_KIT_DIR]
/** The host's registry of shared UI modules; its keys are what a plugin may import. */
const HOST_SHARED_MODULES = 'apps/ui/src/app/pluginSharedModules.ts'
/** Local, gitignored output of the template's own tooling (`.preview-data` is the preview's store). */
const SKIP = new Set(['node_modules', 'dist', '.turbo', '.preview-data'])

/**
 * Everything the kit is made from, repository-relative: a change to any of these is a stale kit.
 * One list, read by the dev watcher (re-stage while the API runs) and by packaging (its cache
 * key), so the two cannot disagree about when a kit is current.
 */
export const MINI_APP_KIT_INPUTS = [
  'scripts/stage-plugin-kit.mjs',
  'scripts/stage-plugin-kit-styles.mjs',
  'scripts/stage-plugin-kit-types.mjs',
  'apps/api/src/features/plugins/authoring/kit-layout.ts',
  'apps/ui/src/app',
  // The kit's component declarations are read from its primitives, its tokens from its styles.
  'packages/kit/src',
  'packages/kit/styles',
  // Modules the host lends re-export host composites.
  'apps/ui/src/shared/ui',
  'packages/mini-app-sdk/dist',
  // Declarations the SDK's own declarations import (`stage-plugin-kit-types.mjs`).
  'packages/agent/dist',
  'packages/dataview/dist',
  'packages/search/dist',
  `${MINI_APPS_DIR}/template`,
]

/** The plugin that describes itself as the template (it carries a scaffold description). */
export function findTemplateMiniApp(repoRoot) {
  const plugins = miniAppsRoot(repoRoot)
  const found = readdirSync(plugins).filter((name) =>
    existsSync(join(plugins, name, TEMPLATE_SCAFFOLD_FILE)),
  )
  if (found.length !== 1)
    throw new Error(`expected one plugin with ${TEMPLATE_SCAFFOLD_FILE}, found ${found.length}`)
  return join(plugins, found[0])
}

/** Value exports of an ES module, following relative `export *` chains. */
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

function copyTemplate(templateDir, outDir) {
  const scaffold = JSON.parse(readFileSync(join(templateDir, TEMPLATE_SCAFFOLD_FILE), 'utf8'))
  const authoringOnly = scaffold.authoringOnly ?? []
  cpSync(templateDir, outDir, {
    recursive: true,
    filter: (src) => {
      const rel = relative(templateDir, src).split(sep).join('/')
      if (!rel) return true
      if (SKIP.has(basename(src)) || src.endsWith('.tsbuildinfo')) return false
      return !authoringOnly.some((entry) =>
        entry.endsWith('/') ? `${rel}/`.startsWith(entry) : rel === entry,
      )
    },
  })
}

/**
 * Prebuild the backend and test shared modules as ONE split build, so `zod` inside the SDK and
 * the `zod` a plugin imports are the same module. Entries are generated inside the repository so
 * they resolve its packages.
 */
async function buildBackendModules(repoRoot, outDir) {
  const specifiers = [...MINI_APP_BACKEND_SHARED_MODULES, ...MINI_APP_TEST_EXTRA_MODULES]
  mkdirSync(join(repoRoot, '.turbo'), { recursive: true })
  const scratch = mkdtempSync(join(repoRoot, '.turbo', 'plugin-kit-'))
  try {
    const entries = specifiers.map((specifier) => {
      const id = specifier.replace(/[^a-z0-9]+/giu, '-').replace(/^-/u, '')
      const file = join(scratch, `${id}.mjs`)
      writeFileSync(file, `export * from '${specifier}'\n`)
      // The bundler names every output `.js`; the kit's own package.json marks them ES modules.
      return { specifier, file, output: `${id}.js` }
    })
    const result = await Bun.build({
      entrypoints: entries.map((entry) => entry.file),
      outdir: outDir,
      root: scratch,
      target: 'bun',
      format: 'esm',
      splitting: true,
      naming: { entry: '[name].[ext]', chunk: 'chunks/[name]-[hash].[ext]' },
    })
    if (!result.success) throw new Error(result.logs.map(String).join('\n'))
    const modules = Object.fromEntries(
      entries.map(({ specifier, output }) => [specifier, `${PLUGIN_KIT_BACKEND_DIR}/${output}`]),
    )
    writeFileSync(join(outDir, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`)
    writeFileSync(join(outDir, basename(PLUGIN_KIT_TEST_PRELOAD)), testPreload(modules))
    return modules
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** A test preload that answers each shared specifier with the kit's module (Bun virtual modules). */
function testPreload(modules) {
  const files = Object.fromEntries(
    Object.entries(modules).map(([specifier, file]) => [specifier, `./${basename(file)}`]),
  )
  return `// Generated by scripts/stage-plugin-kit.mjs. A user plugin has no node_modules: its tests get
// the shared modules from the kit, the same copies its backend build bundles.
import { plugin } from 'bun'

const files = ${JSON.stringify(files, null, 2)}
const loaded = await Promise.all(
  Object.entries(files).map(async ([specifier, file]) => [specifier, await import(new URL(file, import.meta.url).href)]),
)
plugin({
  name: 'localix-plugin-kit',
  setup(build) {
    for (const [specifier, exports] of loaded) build.module(specifier, () => ({ exports, loader: 'object' }))
  },
})
`
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
    modules[name] = join(PLUGIN_KIT_UI_VENDOR_DIR, name, manifest.module).split(sep).join('/')
  }
  return modules
}

/**
 * `KIT.md`: the kit catalog a plugin author chooses from, by job. The catalog lives in the kit
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
    'Every control, overlay, row and state a plugin view needs is one of these modules. Find the',
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
  writeFileSync(join(outKit, PLUGIN_KIT_CATALOG), `${intro}\n${renderKitCatalog()}`)
  return PLUGIN_KIT_CATALOG
}

export async function stageMiniAppKit({ repoRoot, outKit, log = () => {} }) {
  rmSync(outKit, { recursive: true, force: true })
  mkdirSync(outKit, { recursive: true })
  copyTemplate(findTemplateMiniApp(repoRoot), join(outKit, PLUGIN_KIT_TEMPLATE_DIR))
  const stylesDir = join(outKit, PLUGIN_KIT_STYLES_DIR)
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
    schemaVersion: PLUGIN_KIT_SCHEMA_VERSION,
    kitModules: kitModuleIds(repoRoot),
    kitDigest: types.kitDigest,
    kitCatalog: await stageKitCatalog(repoRoot, outKit),
    uiSharedExports: shared,
    typePaths: types.typePaths,
    typescript: types.typescript,
    hostStylesheet: join(PLUGIN_KIT_STYLES_DIR, hostStylesheet).split(sep).join('/'),
    backendModules: await buildBackendModules(repoRoot, join(outKit, PLUGIN_KIT_BACKEND_DIR)),
    uiVendorModules: stageVendorPackages(repoRoot, join(outKit, PLUGIN_KIT_UI_VENDOR_DIR)),
  }
  writeFileSync(join(outKit, PLUGIN_KIT_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`)
  if (types.kitRejected.length) {
    log(
      `kit modules declared by name only (their types did not compile): ${types.kitRejected.join(', ')}`,
    )
  }
  log('staged the plugin kit')
  return manifest
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.path)) {
  const args = process.argv.slice(2)
  const cacheRoot = args.find((arg) => arg.startsWith('--cache='))?.slice('--cache='.length)
  const [repoRoot, outKit] = args.filter((arg) => !arg.startsWith('--'))
  if (!repoRoot || !outKit) {
    console.error('Usage: bun scripts/stage-plugin-kit.mjs <repoRoot> <outKit> [--cache=<dir>]')
    process.exit(2)
  }
  // Staged beside, then swapped in: a running API re-staged under (the dev watcher) must never
  // read half a kit.
  const target = resolve(outKit)
  const next = `${target}.next-${process.pid}`
  const root = resolve(repoRoot)
  const log = (line) => console.log(`[plugin-kit] ${line}`)
  try {
    // Development only (`--cache`): reuse the kit staged for identical inputs. See
    // `plugin-kit-cache.mjs` for why a kit is safe to reuse and why the key is content.
    const digest = cacheRoot ? kitInputsDigest(root, MINI_APP_KIT_INPUTS) : null
    const hit = digest ? cachedKit(cacheRoot, digest, PLUGIN_KIT_MANIFEST) : null
    if (hit) {
      cpSync(hit, next, { recursive: true })
      log('reused the plugin kit')
    } else {
      await stageMiniAppKit({ repoRoot: root, outKit: next, log })
      // An input edited while staging ran makes this kit match neither digest; keep it uncached.
      if (digest && kitInputsDigest(root, MINI_APP_KIT_INPUTS) === digest) {
        storeKit(cacheRoot, digest, next)
      }
    }
    rmSync(target, { recursive: true, force: true })
    renameSync(next, target)
  } catch (error) {
    rmSync(next, { recursive: true, force: true })
    console.error(`[plugin-kit] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

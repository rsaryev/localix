// The type half of the plugin kit: what lets the app TYPE-CHECK a user plugin, and lets the editor
// LSP show real diagnostics for one, without a source tree or `node_modules`.
//
// Why: a user plugin was only bundled and run, and bundling erases types. one plugin shipped a
// timer that published `{ strategy: 'replace', text }` where the SDK takes `{ strategy, bindings }`;
// every check passed and the tab crashed at render. Meanwhile the LSP told the agent
// "Cannot find module '@localixai/mini-app-sdk/ui'" on every edit, so the agent learned
// to ignore diagnostics altogether. So staging copies the DECLARATIONS of every module a plugin may
// import, plus a pure-JavaScript TypeScript to check them with (the repository's own compiler is a
// native binary per platform), and records, per importable specifier, the declaration file that
// answers it. The build turns that record into the plugin's `tsconfig.json`.
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'

import { PLUGIN_KIT_DIGEST } from '@localixai/api/plugin-kit-layout'
import { compilerDir } from '@localixai/mini-app-kit-compiler'

import { declareKitModules, verifyKitDeclarations } from './stage-plugin-kit-declarations.mjs'

const TYPES_DIR = 'types'
const DECLARATION = /\.d\.[cm]?ts$/u
/** Workspace packages `@localixai/mini-app-sdk`'s declarations import (see the staging loop). */
export const SDK_DECLARATION_DEPENDENCIES = [
  '@localixai/agent',
  '@localixai/dataview',
  '@localixai/search',
]

/** A package's directory, found by walking `node_modules` upward (exports may hide package.json). */
function packageDir(name, fromDir) {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    if (dirname(dir) === dir) throw new Error(`plugin kit types: cannot find package ${name}`)
  }
}

/** Copy only what `keep` accepts (directories are walked), never a nested `node_modules`. */
function copyFiltered(source, target, keep) {
  cpSync(source, target, {
    recursive: true,
    filter: (src) => {
      if (relative(source, src).split(sep).includes('node_modules')) return false
      return statSync(src).isDirectory() || keep(src)
    },
  })
}

/** Copy a package's declarations and manifest to `<out>/node_modules/<as>`. */
function copyDeclarations(source, outRoot, as) {
  const target = join(outRoot, 'node_modules', as)
  copyFiltered(source, target, (src) => DECLARATION.test(src) || basename(src) === 'package.json')
  return target
}

/**
 * Packages whose importable entries are each ONE self-contained declaration file. Copying every
 * `.d.ts` of lucide-react shipped 15.6 MB of which TypeScript reads 2.3 MB: its prefixed, suffixed
 * and dynamic-import variants each repeat all icons, and a plugin can only import the root. So for
 * these only the entry files are copied — and staging fails, rather than shipping declarations
 * that resolve to nothing, if an entry ever starts importing a sibling file.
 */
const ENTRY_ONLY_PACKAGES = new Set(['lucide-react'])
const RELATIVE_DECLARATION_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]\.\.?\/|<reference\s+path=/u

/** Copy `package.json` and the declaration file of each subpath, nothing else. */
function copyEntryDeclarations(source, outRoot, as, subpaths) {
  const target = join(outRoot, 'node_modules', as)
  mkdirSync(target, { recursive: true })
  cpSync(join(source, 'package.json'), join(target, 'package.json'))
  for (const subpath of subpaths) {
    const file = typesEntry(source, subpath)
    if (RELATIVE_DECLARATION_IMPORT.test(readFileSync(file, 'utf8'))) {
      throw new Error(
        `plugin kit types: ${as}'s ${relative(source, file)} imports a sibling declaration; ` +
          'stage the whole package (remove it from ENTRY_ONLY_PACKAGES)',
      )
    }
    const staged = join(target, relative(source, file))
    mkdirSync(dirname(staged), { recursive: true })
    cpSync(file, staged)
  }
  return target
}

/** The declaration file a package's manifest names for `subpath` ('.' for the root). */
function typesEntry(dir, subpath = '.') {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const exported = manifest.exports?.[subpath]
  const pick = (value) =>
    typeof value === 'string'
      ? value
      : (value?.types ?? pick(value?.import) ?? pick(value?.default) ?? pick(value?.require))
  const fromExports = exported === undefined ? undefined : pick(exported)
  const declared = fromExports && DECLARATION.test(fromExports) ? fromExports : undefined
  const file =
    declared ??
    (subpath === '.' ? (manifest.types ?? manifest.typings ?? 'index.d.ts') : `${subpath}.d.ts`)
  const path = join(dir, file)
  if (!existsSync(path))
    throw new Error(`plugin kit types: ${manifest.name} has no declarations for ${subpath}`)
  return path
}

/**
 * Stage `<outKit>/types` and return `{ typePaths, typescript }`, kit-relative: `typePaths` maps each
 * importable specifier to its declaration file; `typescript` is the compiler module.
 */
export function stageMiniAppKitTypes({ repoRoot, outKit, uiSharedExports, sdkDir, kitDirs }) {
  const out = join(outKit, TYPES_DIR)
  mkdirSync(out, { recursive: true })
  const rel = (path) => relative(outKit, path).split(sep).join('/')
  const typePaths = {}
  const from = join(repoRoot, 'apps', 'ui')

  // The SDK: every exported subpath is importable, so each gets its own entry.
  const sdk = copyDeclarations(sdkDir, out, '@localixai/mini-app-sdk')
  // The workspace packages the SDK's own declarations import. Not importable by a plugin, but
  // without them `ctx.defineTool` (typed by `@localixai/agent`) resolves to nothing, and
  // `skipLibCheck` turns nothing into `any` without a word: an installed app type-checked a tool
  // with `executionMode: 'serial'` and `execute(input)` as clean. A kit staged inside the checkout
  // never showed it — resolution walked up to the repository's own node_modules.
  for (const name of SDK_DECLARATION_DEPENDENCIES) {
    copyDeclarations(join(repoRoot, 'packages', name.replace('@localixai/', '')), out, name)
  }
  const sdkManifest = JSON.parse(readFileSync(join(sdkDir, 'package.json'), 'utf8'))
  for (const subpath of Object.keys(sdkManifest.exports ?? {})) {
    if (subpath === '.' || subpath.includes('*')) continue
    const exported = sdkManifest.exports[subpath]
    const types = typeof exported === 'object' ? exported.types : undefined
    if (types && existsSync(join(sdk, types))) {
      typePaths[`@localixai/mini-app-sdk/${subpath.slice(2)}`] = rel(join(sdk, types))
    }
  }

  // Third-party modules a plugin may import, and the packages their declarations reference.
  const packages = [
    [
      '@types/react',
      ['react', '.'],
      ['react/jsx-runtime', './jsx-runtime'],
      ['react/jsx-dev-runtime', './jsx-dev-runtime'],
    ],
    ['@types/react-dom', ['react-dom', '.'], ['react-dom/client', './client']],
    ['csstype'],
    ['zod', ['zod', '.']],
    ['hono', ['hono', '.']],
    ['lucide-react', ['lucide-react', '.']],
    ['@types/bun'],
    ['bun-types'],
    ['@types/node'],
    ['undici-types'],
  ]
  for (const [name, ...entries] of packages) {
    const source = packageDir(name, from)
    const staged = ENTRY_ONLY_PACKAGES.has(name)
      ? copyEntryDeclarations(
          source,
          out,
          name,
          entries.map(([, subpath]) => subpath),
        )
      : copyDeclarations(source, out, name)
    for (const [specifier, subpath] of entries)
      typePaths[specifier] = rel(typesEntry(staged, subpath))
  }

  // The kit is a source package (and a few host-lent modules), never built: each module is
  // declared from its real types (`stage-plugin-kit-declarations.mjs`), so a wrong prop is an error
  // that names the right ones. A module the compiler could not describe falls back to the names
  // the kit exports.
  const kitDir = join(out, 'kit')
  mkdirSync(kitDir, { recursive: true })
  const described = declareKitModules({ repoRoot, kitDirs, digest: PLUGIN_KIT_DIGEST })
  const kitNames = {}
  for (const [specifier, names] of Object.entries(uiSharedExports)) {
    if (!specifier.startsWith('@localixai/kit/')) continue
    const id = specifier.slice('@localixai/kit/'.length)
    const file = join(kitDir, `${id}.d.ts`)
    kitNames[id] = names
    writeFileSync(file, described.declarations.get(id) ?? nameOnlyDeclaration(id, names))
    typePaths[specifier] = rel(file)
  }
  // A generated file the compiler rejects is worse than a names-only one: under the plugin
  // check's `skipLibCheck` its broken types would silently turn into `any`.
  const rejected = verifyKitDeclarations({ dir: kitDir, kitDir: outKit, typePaths })
  for (const file of rejected) {
    const id = file.replace(/\.d\.ts$/u, '')
    writeFileSync(join(kitDir, file), nameOnlyDeclaration(id, kitNames[id] ?? []))
  }
  const kitDigest = PLUGIN_KIT_DIGEST.flatMap((entry) =>
    rejected.has(`${entry.split(':')[0]}.d.ts`) ? [] : (described.lines.get(entry) ?? []),
  )

  // A JavaScript TypeScript: one compiler for every platform the app ships to.
  const compiler = compilerDir
  const tsOut = join(outKit, 'typescript')
  mkdirSync(tsOut, { recursive: true })
  cpSync(join(compiler, 'package.json'), join(tsOut, 'package.json'))
  copyFiltered(join(compiler, 'lib'), join(tsOut, 'lib'), (src) =>
    /^(?:typescript\.js|lib\..+\.d\.ts)$/u.test(basename(src)),
  )
  writeFileSync(join(tsOut, 'check.mjs'), CHECK_RUNNER)
  return {
    typePaths,
    typescript: rel(join(tsOut, 'lib', 'typescript.js')),
    kitDigest,
    kitRejected: [...rejected].sort((a, b) => a.localeCompare(b)),
  }
}

function nameOnlyDeclaration(id, names) {
  const lines = names
    .filter((name) => name !== 'default' && /^[A-Za-z_$][\w$]*$/u.test(name))
    .map((name) => `export declare const ${name}: any`)
  return `// Generated: the names @localixai/kit/${id} exports.\n${lines.join('\n')}\nexport {}\n`
}

/**
 * `bun check.mjs <pluginDir>`: type-check the plugin against its generated `tsconfig.json` and
 * print one JSON object per diagnostic. A child process, because the compiler is synchronous and
 * would stall every session the API serves for the seconds a check takes.
 */
const CHECK_RUNNER = `// Generated by scripts/stage-plugin-kit-types.mjs.
import { relative } from 'node:path'
import ts from './lib/typescript.js'

const dir = process.argv[2]
const configPath = ts.findConfigFile(dir, ts.sys.fileExists, 'tsconfig.json')
const report = (diagnostic) => {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\\n')
  const at = diagnostic.file && diagnostic.start !== undefined
    ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    : null
  const file = diagnostic.file ? relative(dir, diagnostic.file.fileName) : null
  console.log(JSON.stringify({ file, line: at ? at.line + 1 : null, column: at ? at.character + 1 : null, code: diagnostic.code, message }))
}
const config = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: report,
})
if (config) {
  const program = ts.createProgram({ rootNames: config.fileNames, options: config.options })
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) report(diagnostic)
}
`

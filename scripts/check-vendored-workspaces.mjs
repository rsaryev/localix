import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const monacoRuntimeRoot = join(root, 'vendor/monaco-editor-runtime')

const readJson = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'))

const rootPackage = await readJson('package.json')
const uiPackage = await readJson('apps/ui/package.json')
const runtimePackage = await readJson('vendor/monaco-editor-runtime/package.json')
const piAgentPackage = await readJson('vendor/pi/packages/agent/package.json')
const piRuntimePackage = await readJson('packages/agent-runtime-pi/package.json')
const formatterConfig = await readFile(join(root, '.oxfmtrc.json'), 'utf8')
const linterConfig = await readFile(join(root, '.oxlintrc.json'), 'utf8')
const knipConfig = await readFile(join(root, 'knip.json'), 'utf8')

assert(rootPackage.workspaces.includes('vendor/monaco-editor-runtime'))
assert(rootPackage.workspaces.includes('vendor/pi/packages/*'))
assert.equal(uiPackage.dependencies['monaco-editor'], 'workspace:*')
assert.equal(runtimePackage.name, 'monaco-editor')
assert.equal(runtimePackage.localixSource.upstreamVersion, '0.57.0')
assert.equal(runtimePackage.dependencies, undefined)
assert.equal(runtimePackage.devDependencies, undefined)
assert.equal(piAgentPackage.dependencies['@earendil-works/pi-ai'], 'workspace:*')
assert.equal(piRuntimePackage.dependencies['@earendil-works/pi-agent-core'], 'workspace:*')
assert.equal(piRuntimePackage.dependencies['@earendil-works/pi-ai'], 'workspace:*')
assert(formatterConfig.includes('"vendor"'))
assert(linterConfig.includes('"vendor"'))
assert(knipConfig.includes('"vendor/**"'))

async function findNestedRepositories(directory) {
  const nested = []
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.name === '.git') {
      nested.push(relative(root, path))
    } else if (entry.isDirectory()) {
      nested.push(...(await findNestedRepositories(path)))
    }
  }
  return nested
}

assert.deepEqual(
  await findNestedRepositories(join(root, 'vendor')),
  [],
  'vendor/ must contain reviewed runtime snapshots, not full upstream Git repositories',
)

const runtimeFiles = [
  'LICENSE',
  'ThirdPartyNotices.txt',
  'esm/external/@vscode/l10n/dist/browser.js',
  'esm/vs/editor/editor.api.js',
  'esm/vs/editor/editor.worker.js',
  'esm/vs/features/register.all.js',
  'esm/vs/languages/definitions/cpp/register.js',
  'esm/vs/languages/definitions/cpp/cpp.js',
  'esm/vs/languages/features/json/register.js',
  'esm/vs/languages/features/json/json.worker.js',
]

await Promise.all(runtimeFiles.map((path) => access(join(monacoRuntimeRoot, path))))

// Upstream's ESM build inlines monaco-editor's own npm dependencies under `esm/external/`,
// and upstream's ThirdPartyNotices.txt does not cover them — it covers what Microsoft
// incorporated into monaco-editor itself. Redistributing those packages carries their MIT
// notice with them, so every one must be named in the Localix-maintained notice file or
// carry its own license beside its code. Enumerated rather than listed by name: refreshing
// the runtime can introduce a package, and an unattributed one must fail the build.
const bundledPackagesRoot = join(monacoRuntimeRoot, 'esm/external')
const localixNotices = await readFile(
  join(monacoRuntimeRoot, 'THIRD_PARTY_NOTICES.localix.txt'),
  'utf8',
)
const bundledPackageNames = []
for (const entry of await readdir(bundledPackagesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  // A scope directory (`@vscode`) holds packages, and is not one itself.
  if (entry.name.startsWith('@')) {
    for (const scoped of await readdir(join(bundledPackagesRoot, entry.name), {
      withFileTypes: true,
    })) {
      if (scoped.isDirectory()) bundledPackageNames.push(`${entry.name}/${scoped.name}`)
    }
    continue
  }
  bundledPackageNames.push(entry.name)
}

const unattributedBundledPackages = []
for (const name of bundledPackageNames) {
  if (localixNotices.includes(`%% ${name} (`)) continue
  try {
    await access(join(bundledPackagesRoot, name, 'LICENSE'))
  } catch {
    unattributedBundledPackages.push(name)
  }
}
assert.deepEqual(
  unattributedBundledPackages,
  [],
  'Bundled Monaco dependencies are redistributed without their license notice. Add each to ' +
    `vendor/monaco-editor-runtime/THIRD_PARTY_NOTICES.localix.txt:\n${unattributedBundledPackages.join('\n')}`,
)

async function* walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) yield* walkFiles(path)
    else if (entry.isFile()) yield path
  }
}

// The upstream ESM tree contains relative imports into bundled transitive dependencies.
// A partial copy can retain every entrypoint yet fail only when Vite reaches a worker.
// Resolve every static relative import so the cheap vendor gate catches that class first.
const missingRelativeImports = []
const relativeImportPattern =
  /^\s*(?:import|export)\s+(?:(?:[^'"\n]*?\sfrom\s+)?['"](\.[^'"]+)['"]|\(\s*['"](\.[^'"]+)['"]\))/gmu
for await (const file of walkFiles(join(monacoRuntimeRoot, 'esm'))) {
  if (!file.endsWith('.js')) continue
  const source = await readFile(file, 'utf8')
  for (const match of source.matchAll(relativeImportPattern)) {
    const specifier = match[1] ?? match[2]
    const target = join(dirname(file), specifier)
    try {
      await access(target)
    } catch {
      missingRelativeImports.push(`${relative(monacoRuntimeRoot, file)} -> ${specifier}`)
    }
  }
}
assert.deepEqual(
  missingRelativeImports,
  [],
  `Vendored Monaco has unresolved relative imports:\n${missingRelativeImports.join('\n')}`,
)

const lockfile = await readFile(join(root, 'bun.lock'), 'utf8')
assert(lockfile.includes('monaco-editor@workspace:vendor/monaco-editor-runtime'))
assert(lockfile.includes('@earendil-works/pi-ai@workspace:vendor/pi/packages/ai'))
assert(lockfile.includes('@earendil-works/pi-agent-core@workspace:vendor/pi/packages/agent'))
// `agent` imports both of these and `ai` imports telemetry; resolving either from npm instead
// of the snapshot is a silent version skew against the vendored source.
assert(lockfile.includes('@earendil-works/chord@workspace:vendor/pi/packages/chord'))
assert(lockfile.includes('@earendil-works/pi-telemetry@workspace:vendor/pi/packages/telemetry'))
assert(!lockfile.includes('"monaco-editor": ["monaco-editor@0.'))

const gitAttributes = await readFile(join(root, '.gitattributes'), 'utf8')
assert(gitAttributes.includes('vendor/monaco-editor-runtime/esm/** linguist-vendored'))
assert(gitAttributes.includes('vendor/pi/** linguist-vendored'))

console.log(
  `[vendor] Monaco ${runtimePackage.localixSource.upstreamVersion} and Pi workspaces are complete.`,
)

import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, parse, relative } from 'node:path'

import { readExtensionManifest } from './lib/extension-manifest.mjs'

import {
  RUST_NOTICES_FILE,
  buildRustNotices,
  readDesktopCargoMetadata,
} from './rust-third-party-notices.mjs'

const NOTICE_FILES = [
  ['vendor/monaco-editor-runtime/LICENSE', 'monaco-editor-LICENSE.txt'],
  ['vendor/monaco-editor-runtime/ThirdPartyNotices.txt', 'monaco-editor-ThirdPartyNotices.txt'],
  [
    'vendor/monaco-editor-runtime/THIRD_PARTY_NOTICES.localix.txt',
    'monaco-editor-bundled-dependencies-NOTICES.txt',
  ],
  // The script sandbox ships quickjs.wasm, QuickJS-NG built by quickjs-wasi; the npm package carries
  // only the wrapper's license, and QuickJS-NG's notice must travel with the engine.
  ['packages/engine-scripts/licenses/quickjs-ng-LICENSE.txt', 'quickjs-ng-LICENSE.txt'],
]

const GENERATED_RUNTIME_NOTICES = 'npm-runtime-THIRD_PARTY_NOTICES.txt'
// The desktop app also ships the Bun sidecar and the Rust shell, which no npm manifest describes.
const BUN_RUNTIME_NOTICE = [
  'apps/desktop-tauri/licenses/bun-LICENSE.txt',
  'bun-runtime-LICENSE.txt',
]
const PRODUCT_RUNTIME_ROOTS = ['apps/api', 'apps/ui']
const LANDING_RUNTIME_ROOTS = ['apps/landing']
const NOTICE_BASENAME_RE = /^(?:licen[cs]e|unlicense|copying|copyright|notice)(?:[._-].*)?$/iu

function readManifest(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function isPrivatePluginDir(pluginsRoot, name) {
  try {
    return readExtensionManifest(join(pluginsRoot, name)).private === true
  } catch {
    return false
  }
}

function workspaceManifestPaths(repoRoot) {
  const rootManifest = readManifest(join(repoRoot, 'package.json'))
  const paths = []
  for (const pattern of rootManifest.workspaces ?? []) {
    if (pattern.endsWith('/*')) {
      const parent = join(repoRoot, pattern.slice(0, -2))
      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const manifestPath = join(parent, entry.name, 'package.json')
        try {
          if (statSync(manifestPath).isFile()) paths.push(manifestPath)
        } catch {
          // A workspace glob may contain non-package directories.
        }
      }
      continue
    }
    paths.push(join(repoRoot, pattern, 'package.json'))
  }
  return paths
}

function installedManifestPath(fromManifestPath, packageName) {
  let current = dirname(fromManifestPath)
  const root = parse(current).root
  while (current !== root) {
    const candidate = join(current, 'node_modules', ...packageName.split('/'), 'package.json')
    try {
      if (readManifest(candidate).name === packageName) return candidate
    } catch {
      // Keep walking through the package's Node-style resolution ancestry.
    }
    current = dirname(current)
  }
  throw new Error(`Could not locate the package manifest for ${packageName}`)
}

function runtimeDependencies(manifest) {
  const optional = new Set(Object.keys(manifest.optionalDependencies ?? {}))
  return Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })
    .sort()
    .map((name) => ({ name, optional: optional.has(name) }))
}

function packageNoticeFiles(packageRoot) {
  return readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && NOTICE_BASENAME_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
}

function runtimeRootManifestPaths(repoRoot, target) {
  const roots = (target === 'landing' ? LANDING_RUNTIME_ROOTS : PRODUCT_RUNTIME_ROOTS).map((path) =>
    join(repoRoot, path, 'package.json'),
  )
  if (target === 'landing') return roots

  const plugins = join(repoRoot, 'plugins')
  for (const entry of readdirSync(plugins, { withFileTypes: true })) {
    if (!entry.isDirectory() || isPrivatePluginDir(plugins, entry.name)) continue
    const manifestPath = join(plugins, entry.name, 'package.json')
    try {
      if (statSync(manifestPath).isFile()) roots.push(manifestPath)
    } catch {
      // Plugins without npm dependencies have no package.json.
    }
  }
  return roots.sort((left, right) => left.localeCompare(right))
}

/** Build the installed external runtime dependency closure for one distributable surface. */
export function collectRuntimeNoticePackages({ repoRoot, target = 'product' }) {
  if (target !== 'product' && target !== 'landing') {
    throw new Error(`Unknown third-party notice target: ${target}`)
  }
  const workspaceByName = new Map()
  for (const manifestPath of workspaceManifestPaths(repoRoot)) {
    const manifest = readManifest(manifestPath)
    if (typeof manifest.name === 'string') workspaceByName.set(manifest.name, manifestPath)
  }

  const pending = runtimeRootManifestPaths(repoRoot, target)
  const visitedManifests = new Set()
  const externalPackages = new Map()
  while (pending.length > 0) {
    const manifestPath = pending.pop()
    if (!manifestPath || visitedManifests.has(manifestPath)) continue
    visitedManifests.add(manifestPath)
    const manifest = readManifest(manifestPath)
    for (const dependency of runtimeDependencies(manifest)) {
      const workspacePath = workspaceByName.get(dependency.name)
      if (workspacePath) {
        pending.push(workspacePath)
        continue
      }

      let dependencyManifestPath
      let dependencyManifest
      try {
        dependencyManifestPath = installedManifestPath(manifestPath, dependency.name)
        dependencyManifest = readManifest(dependencyManifestPath)
      } catch {
        if (dependency.optional) continue
        throw new Error(
          `Runtime dependency ${dependency.name} from ${relative(repoRoot, manifestPath)} is not installed`,
        )
      }
      const key = `${dependencyManifest.name}@${dependencyManifest.version}`
      if (!externalPackages.has(key)) {
        const packageRoot = dirname(dependencyManifestPath)
        const notices = packageNoticeFiles(packageRoot)
        if (notices.length === 0 && !dependencyManifest.license) {
          throw new Error(
            `Runtime dependency ${dependency.name} at ${relative(repoRoot, dependencyManifestPath)} has no license metadata or notice file`,
          )
        }
        externalPackages.set(key, {
          name: dependencyManifest.name,
          version: dependencyManifest.version,
          license: dependencyManifest.license,
          packageRoot,
          notices,
        })
        pending.push(dependencyManifestPath)
      }
    }
  }

  return [...externalPackages.values()].sort((left, right) => {
    const byName = left.name.localeCompare(right.name)
    return byName || String(left.version).localeCompare(String(right.version))
  })
}

export function buildRuntimeNotices({ repoRoot, target = 'product' }) {
  const packages = collectRuntimeNoticePackages({ repoRoot, target })
  const output = [
    'THIRD-PARTY SOFTWARE NOTICES AND INFORMATION',
    '',
    `Runtime dependency set: ${target}`,
    `Packages: ${packages.length}`,
    '',
  ]
  for (const pkg of packages) {
    output.push(
      '='.repeat(80),
      `${pkg.name}@${pkg.version}`,
      `Declared license: ${pkg.license ?? 'UNKNOWN'}`,
    )
    if (pkg.notices.length === 0) {
      output.push('No license or notice text was included in the installed package.')
    }
    for (const filename of pkg.notices) {
      const content = readFileSync(join(pkg.packageRoot, filename), 'utf8').replace(/\r\n?/gu, '\n')
      output.push(`--- ${filename} ---`, content.trimEnd())
    }
    output.push('')
  }
  return `${output.join('\n').trimEnd()}\n`
}

/**
 * Stage the notices for vendored code that is compiled into distributable artifacts. `desktop`
 * adds the Bun runtime and the Rust crates of the native shell, resolved for `targetTriple` (or
 * from a supplied `metadata`).
 */
export function stageThirdPartyNotices({ repoRoot, destination, target = 'product', desktop }) {
  mkdirSync(destination, { recursive: true })
  if (target === 'product') {
    for (const [source, filename] of NOTICE_FILES) {
      copyFileSync(join(repoRoot, source), join(destination, filename))
    }
  }
  writeFileSync(
    join(destination, GENERATED_RUNTIME_NOTICES),
    buildRuntimeNotices({ repoRoot, target }),
  )
  if (!desktop) return
  copyFileSync(join(repoRoot, BUN_RUNTIME_NOTICE[0]), join(destination, BUN_RUNTIME_NOTICE[1]))
  const metadata =
    desktop.metadata ?? readDesktopCargoMetadata({ repoRoot, targetTriple: desktop.targetTriple })
  writeFileSync(join(destination, RUST_NOTICES_FILE), buildRustNotices(metadata))
}

export const STAGED_THIRD_PARTY_NOTICE_FILES = [
  ...NOTICE_FILES.map(([, filename]) => filename),
  GENERATED_RUNTIME_NOTICES,
]

export const STAGED_DESKTOP_NOTICE_FILES = [
  ...STAGED_THIRD_PARTY_NOTICE_FILES,
  BUN_RUNTIME_NOTICE[1],
  RUST_NOTICES_FILE,
]

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSync } from 'oxc-parser'
import { readExtensionManifest } from './lib/extension-manifest.mjs'
import { BUNDLED_DIRS, MINI_APPS_PREFIX, appOfPath, bundledRoots } from './lib/bundled-roots.mjs'
import { createPluginIdentityGuard, pluginUiNamespaceProblems } from './plugin-identity-guard.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** A workspace package's folder from a repository path: its group and its name. */
const workspacePathPattern = new RegExp(`^(apps|packages|${BUNDLED_DIRS.join('|')})/([^/]+)/`, 'u')
const sourceExtensions = new Set(['.cjs', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'])
const englishTextExtensions = new Set([
  ...sourceExtensions,
  '.css',
  '.html',
  '.json',
  '.md',
  '.svg',
  '.toml',
  '.yaml',
  '.yml',
])
const skippedDirectories = new Set([
  '.git',
  '.turbo',
  '.vercel',
  'coverage',
  'dist',
  'node_modules',
  'target',
  'vendor',
])
const skippedTrees = [
  // The desktop app's staged release payload (gitignored): mirrors of the plugins, the built API,
  // the CLI launcher and the API migrations, each scanned at its canonical source below. Skipped as
  // ONE tree because listing its entries one by one failed the gate on every checkout that had
  // staged a new kind of payload — the migrations copy named the plugin a migration once served.
  'apps/desktop-tauri/src-tauri/resources/',
  // Generated landing-page modules mirror canonical Markdown and screenshot manifests.
  'apps/landing/src/generated/',
  // Generated/staged CLI payloads are checked through their canonical app/package sources.
  'packages/cli/public/',
  'packages/cli/server/',
]
const uiLayers = new Map([
  ['shared', 0],
  ['entities', 1],
  ['features', 2],
  ['widgets', 3],
  ['pages', 4],
  ['app', 5],
])
const removedInternalProviderSchemes = [
  'capability',
  'chat',
  'db',
  'doc',
  'docker',
  'docs',
  'git',
  'k8s',
  'mcp',
  'model',
  'plugin',
  'trade',
  'vault',
]
const removedInternalProviderUri =
  /(^|[^A-Za-z0-9+.-])(capability|chat|db|doc|docker|docs|git|k8s|mcp|model|plugin|trade|vault):\/\//gimu
const runtimeCapabilityMutationMethods = new Set([
  'archiveSkill',
  'createAgent',
  'createMcpServer',
  'createSkill',
  'deleteMcpServer',
  'deleteSkill',
  'importMcpServers',
  'installAgentProvider',
  'installPlugin',
  'logoutMcpServerOAuth',
  'removeAgentProvider',
  'removePlugin',
  'restoreSkill',
  'runSkillsCurator',
  'setAgentEnabled',
  'setAgentProviderConfig',
  'setAgentProviderEnabled',
  'setMcpServerEnabled',
  'setMcpToolEnabled',
  'setPluginConfig',
  'setPluginEnabled',
  'setSessionSkills',
  'setSkillPinned',
  'startMcpServerOAuth',
  'updateMcpServer',
])
const auditedRuntimeMutationWrappers = new Map([
  ['apps/ui/src/features/settings/model/useMcpServers.ts', new Set(['runServerMutation'])],
  ['apps/ui/src/features/settings/model/useSkills.ts', new Set(['runSkillMutation'])],
])

// Bundled plugin UI reaches the host only through the public SDK and the host UI kit,
// `@localixai/kit/<id>` — a door of the `packages/kit` package (`src/entries/<id>.ts`) or a module
// the host still lends (`apps/ui/src/app/kit/`, whose README states the admission rule): never
// `@/…` host internals, in source or in tests. The kit is presentation. A kit module that exposes
// host FEATURE state is not, and is importable only along an edge recorded below with the seam that
// would retire it. The map self-cleans: an edge that no longer exists is reported as stale, so a
// debt cannot outlive its cause. Adding one is a decision — the default is to build the seam.
const HOST_UI_KIT = '@localixai/kit'
const pluginKitDebt = new Map([])
/** Kit modules that expose host feature state: only the recorded edges may import them. */
const hostFeatureKitModules = new Set([
  '@localixai/kit/user-settings',
  ...[...pluginKitDebt.keys()].map((edge) => edge.split(' -> ')[1]),
])

// Workspace packages that are intentionally part of the plugin authoring surface.
// Everything else is a host/runtime implementation detail. A package export map is
// not an architectural permission: without this gate a plugin could simply declare
// @localixai/api and bypass the relative-import boundary below.
const pluginPublicWorkspacePackages = new Set([
  '@localixai/agent',
  '@localixai/dataview',
  '@localixai/path-containment',
  '@localixai/mini-app-sdk',
])

/**
 * THE ENGINE'S LAYERS, bottom to top. Each layer reaches only the workspace packages listed for
 * it (its own files aside), so the loop cannot learn a provider, model access cannot learn a
 * turn, and only the composition root sees them all. A layer below the root that needed a
 * sibling would have to say so here — which is the point.
 */
const ENGINE_LAYERS = [
  {
    root: 'packages/engine-loop/',
    name: 'agent loop',
    workspace: ['@localixai/agent'],
    forbidden: [/^@ai-sdk\//u, /^ai(\/|$)/u, /^@opencode-ai\//u],
    why: 'the loop talks to models only through the ModelSession port',
  },
  { root: 'packages/engine-models/', name: 'model access', workspace: ['@localixai/agent'] },
  { root: 'packages/engine-scripts/', name: 'script sandbox', workspace: ['@localixai/agent'] },
  {
    root: 'packages/engine/',
    name: 'engine composition',
    workspace: [
      '@localixai/agent',
      '@localixai/engine-loop',
      '@localixai/engine-models',
      '@localixai/engine-scripts',
    ],
  },
]

async function sourceFiles(directory, extensions = sourceExtensions) {
  const files = []
  if (!existsSync(directory)) return files
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue
    const path = join(directory, entry.name)
    const projectRelative = `${projectPath(path) ?? ''}/`
    if (skippedTrees.some((tree) => projectRelative.startsWith(tree))) continue
    if (entry.isDirectory()) files.push(...(await sourceFiles(path, extensions)))
    else if (entry.isFile() && extensions.has(extname(entry.name))) files.push(path)
  }
  return files
}

async function englishTextFiles(directory) {
  const files = []
  if (!existsSync(directory)) return files
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue
    const path = join(directory, entry.name)
    const projectRelative = `${projectPath(path) ?? ''}/`
    if (skippedTrees.some((tree) => projectRelative.startsWith(tree))) continue
    if (entry.isDirectory()) files.push(...(await englishTextFiles(path)))
    else if (entry.isFile() && englishTextExtensions.has(extname(entry.name))) files.push(path)
  }
  return files
}

function moduleLoadsIn(file, source) {
  const parsed = parseSync(file, source)
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map(({ message }) => message).join('; '))
  }

  const specifiers = [
    ...parsed.module.staticImports.flatMap(({ moduleRequest }) =>
      moduleRequest?.value ? [moduleRequest.value] : [],
    ),
    ...parsed.module.staticExports.flatMap(({ entries }) =>
      entries.flatMap(({ moduleRequest }) => (moduleRequest?.value ? [moduleRequest.value] : [])),
    ),
  ]
  const nonLiteral = []
  for (const { moduleRequest } of parsed.module.dynamicImports) {
    if (!moduleRequest) continue
    const raw = source.slice(moduleRequest.start, moduleRequest.end)
    if (
      raw.length >= 2 &&
      ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"')))
    ) {
      specifiers.push(raw.slice(1, -1))
    } else {
      nonLiteral.push({ kind: 'import', start: moduleRequest.start })
    }
  }

  // Oxc's module table includes ESM imports but deliberately omits CommonJS
  // require(). Walk only for that call shape so package-boundary checks cannot be
  // bypassed by changing one spelling.
  const visit = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (
      node.type === 'CallExpression' &&
      node.callee?.type === 'Identifier' &&
      node.callee.name === 'require'
    ) {
      const argument = node.arguments?.[0]
      if (argument?.type === 'Literal' && typeof argument.value === 'string') {
        specifiers.push(argument.value)
      } else {
        nonLiteral.push({ kind: 'require', start: node.start ?? 0 })
      }
    }
    for (const child of Object.values(node)) visit(child)
  }
  visit(parsed.program)
  return { nonLiteral, specifiers }
}

function importsIn(file, source) {
  return moduleLoadsIn(file, source).specifiers
}

/**
 * Static import specifiers only. {@link importsIn} deliberately merges static and dynamic
 * ones for boundary rules; the DOM-test rule below has to tell them apart, because the whole
 * point there is WHEN the module is evaluated.
 */
function staticImportsIn(file, source) {
  const parsed = parseSync(file, source)
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map(({ message }) => message).join('; '))
  }
  return parsed.module.staticImports.flatMap(({ moduleRequest }) =>
    moduleRequest?.value ? [moduleRequest.value] : [],
  )
}

function untrackedRuntimeCapabilityMutationsIn(file, source, allowedWrappers = new Set()) {
  const parsed = parseSync(file, source)
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map(({ message }) => message).join('; '))
  }
  const violations = []

  const callName = (node) =>
    node?.type === 'CallExpression' && node.callee?.type === 'Identifier' ? node.callee.name : null
  const backendMethod = (node) => {
    if (node?.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression') return null
    const { object, property, computed } = node.callee
    if (
      object?.type !== 'Identifier' ||
      object.name !== 'backendClient' ||
      computed ||
      property?.type !== 'Identifier'
    ) {
      return null
    }
    return runtimeCapabilityMutationMethods.has(property.name) ? property.name : null
  }

  // Infer local forwarding wrappers from their bodies, never from their names. A callback
  // qualifies only when its sole body reference is the callback argument of the barrier.
  const forwardedParameters = (fn) => {
    if (!['ArrowFunctionExpression', 'FunctionExpression'].includes(fn?.type)) return []
    return fn.params.flatMap((parameter, index) => {
      if (parameter.type !== 'Identifier') return []
      let references = 0
      let forwarded = 0
      const inspect = (node, parent) => {
        if (!node || typeof node !== 'object') return
        if (node.type === 'Identifier' && node.name === parameter.name) {
          references += 1
          if (callName(parent) === 'trackCapabilityWrite' && parent.arguments[1] === node)
            forwarded += 1
        }
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) value.forEach((child) => inspect(child, node))
          else if (value && typeof value === 'object') inspect(value, node)
        }
      }
      inspect(fn.body)
      return references === 1 && forwarded === 1 ? [index] : []
    })
  }
  const shadowBinding = (binding, wrappers) => {
    if (!binding) return
    if (binding.type === 'Identifier') wrappers.set(binding.name, [])
    else if (binding.type === 'AssignmentPattern') shadowBinding(binding.left, wrappers)
    else if (binding.type === 'RestElement') shadowBinding(binding.argument, wrappers)
    else if (binding.type === 'ArrayPattern')
      binding.elements.forEach((element) => shadowBinding(element, wrappers))
    else if (binding.type === 'ObjectPattern')
      binding.properties.forEach((property) =>
        shadowBinding(
          property.type === 'RestElement' ? property.argument : property.value,
          wrappers,
        ),
      )
  }

  const visit = (node, protectedByBarrier, wrappers = new Map()) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'Program' || node.type === 'BlockStatement') {
      wrappers = new Map(wrappers)
      for (const statement of node.body) {
        if (statement.type === 'VariableDeclaration') {
          for (const declaration of statement.declarations) {
            shadowBinding(declaration.id, wrappers)
            if (declaration.id.type === 'Identifier')
              wrappers.set(
                declaration.id.name,
                statement.kind === 'const' ? forwardedParameters(declaration.init) : [],
              )
          }
        } else if (statement.type === 'FunctionDeclaration' && statement.id) {
          wrappers.set(statement.id.name, [])
        }
      }
    }
    if (
      ['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(node.type)
    ) {
      wrappers = new Map(wrappers)
      for (const parameter of node.params) shadowBinding(parameter, wrappers)
    }
    const barrierName = callName(node)
    const protectsChildren =
      protectedByBarrier ||
      barrierName === 'trackCapabilityWrite' ||
      allowedWrappers.has(barrierName)
    const method = backendMethod(node)
    if (method && !protectedByBarrier) {
      violations.push({ method, start: node.start ?? 0 })
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'start' || key === 'end') continue
      if (Array.isArray(value)) {
        for (const [index, child] of value.entries())
          visit(
            child,
            protectsChildren ||
              (key === 'arguments' &&
                ['ArrowFunctionExpression', 'FunctionExpression'].includes(child?.type) &&
                wrappers.get(barrierName)?.includes(index)),
            wrappers,
          )
      } else {
        visit(value, protectsChildren, wrappers)
      }
    }
  }

  visit(parsed.program, false)
  return violations.map(({ method, start }) => ({
    method,
    line: source.slice(0, start).split('\n').length,
  }))
}

const namedUiBoundary = /^[A-Z][A-Za-z0-9]*(?:Page|Tab|Panel|Sidebar|Picker|Switcher|Palette)$/u

function isLazyAlias(initializer) {
  if (initializer?.type !== 'CallExpression') return false
  const callee = initializer.callee
  return (
    (callee?.type === 'Identifier' && callee.name === 'lazy') ||
    (callee?.type === 'MemberExpression' &&
      callee.computed === false &&
      callee.object?.type === 'Identifier' &&
      callee.object.name === 'React' &&
      callee.property?.type === 'Identifier' &&
      callee.property.name === 'lazy')
  )
}

/** Semantic React boundary names, independent of the source filename. */
function namedUiBoundariesIn(file, source) {
  const parsed = parseSync(file, source)
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map(({ message }) => message).join('; '))
  }

  const names = new Set()
  const visit = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (
      (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') &&
      namedUiBoundary.test(node.id?.name ?? '')
    ) {
      names.add(node.id.name)
    }
    if (
      node.type === 'VariableDeclarator' &&
      node.id?.type === 'Identifier' &&
      namedUiBoundary.test(node.id.name) &&
      node.init &&
      !isLazyAlias(node.init)
    ) {
      names.add(node.id.name)
    }
    for (const child of Object.values(node)) visit(child)
  }
  visit(parsed.program)
  return [...names].sort((left, right) => left.localeCompare(right))
}

function projectPath(path) {
  const value = relative(root, path)
  return value.startsWith(`..${sep}`) || value === '..' ? null : value.split(sep).join('/')
}

function relativeTarget(importer, specifier) {
  if (!specifier.startsWith('.')) return null
  return projectPath(resolve(dirname(importer), specifier))
}

function uiTarget(importer, specifier) {
  if (specifier.startsWith('@/')) return `apps/ui/src/${specifier.slice(2)}`
  const target = relativeTarget(importer, specifier)
  return target?.startsWith('apps/ui/src/') ? target : null
}

function uiLayer(path) {
  const prefix = 'apps/ui/src/'
  if (!path.startsWith(prefix)) return null
  const [layer, slice] = path.slice(prefix.length).split('/')
  const rank = uiLayers.get(layer)
  return rank === undefined ? null : { layer, rank, slice }
}

function localWorkspacePackageName(specifier) {
  const match = /^(@localix(?:ai|-mini-app)\/[^/]+)/u.exec(specifier)
  // The kit is the host's contract, served by the running host; it is not a package to declare.
  return match?.[1] === HOST_UI_KIT ? null : (match?.[1] ?? null)
}

function miniAppWorkspaceImportProblem(specifier) {
  const packageName = localWorkspacePackageName(specifier)
  if (!packageName || pluginPublicWorkspacePackages.has(packageName)) return null
  return `plugin imports private workspace package ${specifier}; use @localixai/mini-app-sdk or another approved generic building block`
}

function pluginPathHasArea(path, area) {
  return appOfPath(path)?.rest.split('/').includes(area) ?? false
}

function miniAppSdkLayerProblem(path, specifier) {
  if (pluginPathHasArea(path, 'ui') && specifier.startsWith('@localixai/mini-app-sdk/backend')) {
    return `plugin UI imports Node-only SDK surface ${specifier}`
  }
  if (
    (pluginPathHasArea(path, 'backend') || pluginPathHasArea(path, 'tools')) &&
    specifier.startsWith('@localixai/mini-app-sdk/ui')
  ) {
    return `plugin backend imports browser-only SDK surface ${specifier}`
  }
  return null
}

/**
 * A plugin's edge into the host, or null when it is allowed. `@/…` is refused everywhere — the
 * UI artifact build refuses it too. The kit is browser UI: its surfaces, the preview shell and
 * tests. A host-feature kit module is allowed only along a recorded {@link pluginKitDebt} edge.
 */
function miniAppHostBoundaryProblem(path, specifier) {
  if (!appOfPath(path)) return null
  if (specifier.startsWith('@/')) {
    return `plugin imports host internals ${specifier}; use its ${HOST_UI_KIT} module (packages/kit/src/entries, or apps/ui/src/app/kit when the host lends it)`
  }
  if (specifier !== HOST_UI_KIT && !specifier.startsWith(`${HOST_UI_KIT}/`)) return null
  const browserSide =
    pluginPathHasArea(path, 'ui') || pluginPathHasArea(path, 'preview') || /\.test\./u.test(path)
  if (!browserSide) return `non-UI plugin imports the host UI kit ${specifier}`
  if (hostFeatureKitModules.has(specifier)) {
    return `plugin reaches host feature state through ${specifier}; build the seam instead`
  }
  return null
}

/**
 * The kit package's edge out of itself, or null when it is allowed.
 *
 * The kit is the design system the host AND every plugin build from, so it sits below both. A kit
 * module that reaches up into an app — through `@/…`, a relative path, or an app's own package —
 * or into a plugin makes every plugin that imports the kit depend on host internals it cannot
 * see, and turns the package back into the host tree it was cut out of. What the host owns (a
 * setting, a client, a feature's state) reaches a primitive as a prop or a registered port.
 * `appPackageNames` is the set of `apps/*` package names, read from their manifests.
 */
const KIT_PACKAGE_ROOT = 'packages/kit/'
function kitBoundaryProblem(path, specifier, appPackageNames) {
  if (!path.startsWith(KIT_PACKAGE_ROOT)) return null
  if (specifier.startsWith('@/')) {
    return `kit imports host internals ${specifier}; the kit sits below the host — take it as a prop or a port`
  }
  if (specifier.startsWith('@localix-mini-app/')) {
    return `kit imports plugin package ${specifier}; a plugin builds on the kit, never the reverse`
  }
  const packageName = /^(@localixai\/[^/]+)/u.exec(specifier)?.[1]
  if (packageName && appPackageNames.has(packageName)) {
    return `kit imports app package ${specifier}; the kit sits below the apps`
  }
  const target = specifier.startsWith('.')
    ? projectPath(resolve(root, dirname(path), specifier))
    : null
  if (target?.startsWith('apps/') || target?.startsWith(MINI_APPS_PREFIX)) {
    return `kit crosses into ${target} through a relative import`
  }
  return null
}

function removedInternalProviderUrisIn(source) {
  return [...source.matchAll(removedInternalProviderUri)].map((match) => {
    const index = match.index + match[1].length
    const prefix = source.slice(0, index)
    const line = 1 + (prefix.match(/\n/gu)?.length ?? 0)
    const column = index - prefix.lastIndexOf('\n')
    return { column, line, scheme: match[2].toLowerCase() }
  })
}

const fixtureImports = importsIn(
  'fixture.ts',
  `// import ignored from 'comment-only'
import type {
  Fixture,
} from '@localixai/fixture'
export { other } from './other'
void import('./dynamic')
const required = require('@localixai/required')
`,
)
assert.deepEqual(fixtureImports, [
  '@localixai/fixture',
  './other',
  './dynamic',
  '@localixai/required',
])
assert.equal(miniAppWorkspaceImportProblem('@localixai/mini-app-sdk/backend'), null)
assert.equal(miniAppWorkspaceImportProblem('@localixai/agent/agents'), null)
assert.match(
  miniAppWorkspaceImportProblem('@localixai/api/client') ?? '',
  /private workspace package/u,
)
assert.match(
  miniAppWorkspaceImportProblem('@localix-mini-app/sample-extension') ?? '',
  /private workspace package/u,
)
assert.match(
  miniAppSdkLayerProblem(
    `${MINI_APPS_PREFIX}example/ui/register.tsx`,
    '@localixai/mini-app-sdk/backend',
  ) ?? '',
  /Node-only/u,
)
assert.match(
  miniAppSdkLayerProblem(
    `${MINI_APPS_PREFIX}example/backend/index.ts`,
    '@localixai/mini-app-sdk/ui/runtime',
  ) ?? '',
  /browser-only/u,
)
assert.match(
  miniAppSdkLayerProblem(
    `${MINI_APPS_PREFIX}example-suite/docker/ui/register.tsx`,
    '@localixai/mini-app-sdk/backend',
  ) ?? '',
  /Node-only/u,
)
assert.equal(
  miniAppHostBoundaryProblem(`${MINI_APPS_PREFIX}example/ui/register.tsx`, '@localixai/kit/button'),
  null,
)
assert.equal(
  miniAppHostBoundaryProblem(
    `${MINI_APPS_PREFIX}example-suite/docker/ui/register.tsx`,
    '@localixai/kit/button',
  ),
  null,
)
assert.equal(
  miniAppHostBoundaryProblem(
    `${MINI_APPS_PREFIX}example/backend/index.test.ts`,
    '@localixai/kit/testing',
  ),
  null,
)
assert.equal(localWorkspacePackageName('@localixai/kit/button'), null)
for (const path of [
  `${MINI_APPS_PREFIX}example/ui/register.tsx`,
  `${MINI_APPS_PREFIX}example/ui/Panel.test.tsx`,
]) {
  assert.match(
    miniAppHostBoundaryProblem(path, '@/shared/ui/button') ?? '',
    /imports host internals/u,
  )
}
assert.match(
  miniAppHostBoundaryProblem(
    `${MINI_APPS_PREFIX}example/backend/index.ts`,
    '@localixai/kit/button',
  ) ?? '',
  /non-UI plugin/u,
)
assert.match(
  miniAppHostBoundaryProblem(
    `${MINI_APPS_PREFIX}example/ui/Box.tsx`,
    '@localixai/kit/user-settings',
  ) ?? '',
  /host feature state/u,
)
// The kit boundary: each way up out of the package is reported, and its own edges are not.
const fixtureAppPackages = new Set(['@localixai/api', '@localixai/ui'])
for (const [specifier, reason] of [
  ['@/shared/lib/x', /host internals/u],
  ['../../../apps/ui/src/shared/lib/x', /crosses into apps\/ui\/src\/shared\/lib\/x/u],
  [
    `../../../${MINI_APPS_PREFIX}example/ui/x`,
    new RegExp(`crosses into ${MINI_APPS_PREFIX}example/ui/x`, 'u'),
  ],
  ['@localix-mini-app/example', /plugin package/u],
  ['@localixai/api/tool-names', /app package/u],
]) {
  assert.match(
    kitBoundaryProblem('packages/kit/src/x.tsx', specifier, fixtureAppPackages) ?? '',
    reason,
  )
}
for (const specifier of ['./lib/cn', '../styles/x', '@localixai/mini-app-sdk/ui', 'radix-ui']) {
  assert.equal(kitBoundaryProblem('packages/kit/src/x.tsx', specifier, fixtureAppPackages), null)
}
assert.equal(kitBoundaryProblem('apps/ui/src/x.tsx', '@/shared/lib/x', fixtureAppPackages), null)
assert.deepEqual(
  moduleLoadsIn(
    'fixture.ts',
    `const packageName = '@localixai/api'; void import(packageName); require(packageName)`,
  ).nonLiteral.map(({ kind }) => kind),
  ['import', 'require'],
)

const fixtureUiBoundaries = namedUiBoundariesIn(
  'fixture.tsx',
  `
export function NestedPanel() { return <div /> }
export const InlinePicker = () => <div />
const WrappedSidebar = memo(function WrappedSidebar() { return <aside /> })
const DeferredPage = lazy(() => import('./page'))
const ReactDeferredTab = React.lazy(() => import('./tab'))
const closePanel = () => {}
`,
)
assert.deepEqual(fixtureUiBoundaries, ['InlinePicker', 'NestedPanel', 'WrappedSidebar'])

const removedInternalProviderUriFixture = removedInternalProviderSchemes
  .map((scheme) => `${scheme}://${scheme}`)
  .join('\n')
assert.deepEqual(
  removedInternalProviderUrisIn(removedInternalProviderUriFixture).map(({ scheme }) => scheme),
  removedInternalProviderSchemes,
)
assert.deepEqual(
  removedInternalProviderUrisIn(
    'mongodb://db git+https://host registry+https://host localix://resource/db',
  ),
  [],
)
assert.deepEqual(
  untrackedRuntimeCapabilityMutationsIn(
    'fixture.ts',
    `trackCapabilityWrite(null, () => backendClient.setPluginEnabled('x', true))`,
  ),
  [],
)
assert.deepEqual(
  untrackedRuntimeCapabilityMutationsIn('fixture.ts', `backendClient.setPluginEnabled('x', true)`),
  [{ line: 1, method: 'setPluginEnabled' }],
)
assert.deepEqual(
  untrackedRuntimeCapabilityMutationsIn(
    'fixture.ts',
    `const write = async (label, run) => { await trackCapabilityWrite(null, run) }; write('save', () => backendClient.createAgent({}))`,
  ),
  [],
)
for (const fixture of [
  `const write = (run) => run(); write(() => backendClient.createAgent({}))`,
  `const write = (run) => { trackCapabilityWrite(null, run); run() }; write(() => backendClient.createAgent({}))`,
  `const write = (run) => trackCapabilityWrite(null, run); { const write = (run) => run(); write(() => backendClient.createAgent({})) }`,
  `const write = (run) => trackCapabilityWrite(null, run); function bypass(write) { write(() => backendClient.createAgent({})) }`,
  `const write = (run) => trackCapabilityWrite(null, run); function bypass({ write }) { write(() => backendClient.createAgent({})) }`,
  `const write = (label, run) => trackCapabilityWrite(null, run); write(backendClient.createAgent({}), () => {})`,
  `const write = (run) => trackCapabilityWrite(null, run); write(backendClient.createAgent({}))`,
]) {
  assert.equal(untrackedRuntimeCapabilityMutationsIn('fixture.ts', fixture).length, 1)
}

const workspaceManifests = new Map()
for (const directory of ['apps', 'packages', ...BUNDLED_DIRS]) {
  if (!existsSync(join(root, directory))) continue
  for (const entry of await readdir(join(root, directory), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue
    const manifestPath = join(root, directory, entry.name, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const declared = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ])
    workspaceManifests.set(`${directory}/${entry.name}`, {
      declared,
      name: manifest.name,
      scripts: manifest.scripts ?? {},
    })
  }
}

const appPackageNames = new Set(
  [...workspaceManifests]
    .filter(([directory, manifest]) => directory.startsWith('apps/') && manifest.name)
    .map(([, manifest]) => manifest.name),
)
assert(appPackageNames.has('@localixai/api'), 'the app package names were not read')

const problems = []
const observedPluginKitEdges = new Set()
const files = (
  await Promise.all(
    ['apps', 'packages', ...BUNDLED_DIRS, 'scripts'].map((directory) =>
      sourceFiles(join(root, directory)),
    ),
  )
).flat()
const auxiliaryCoreFiles = (
  await Promise.all(
    ['apps', 'packages', 'scripts'].map((directory) =>
      sourceFiles(join(root, directory), new Set(['.rs'])),
    ),
  )
).flat()

// A plugin that owns TypeScript must also own the commands that compile and test it.
// Otherwise the host's tsconfig/test runner has to enumerate concrete plugin trees, or
// the source silently falls outside CI. Keep this structural so newly added plugins are
// covered without extending an allowlist in core.
for (const bundledRoot of bundledRoots(root))
  for (const entry of await readdir(bundledRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const directory = `${relative(root, bundledRoot)}/${entry.name}`
    const ownsTypeScript = files.some(
      (file) => projectPath(file)?.startsWith(`${directory}/`) && /\.(?:ts|tsx)$/u.test(file),
    )
    if (!ownsTypeScript) continue
    const workspace = workspaceManifests.get(directory)
    if (!workspace) {
      problems.push(`${directory}: TypeScript plugin has no package.json compile/test owner`)
      continue
    }
    for (const script of ['test', 'type-check']) {
      if (typeof workspace.scripts[script] !== 'string' || workspace.scripts[script].length === 0) {
        problems.push(`${directory}: TypeScript plugin package is missing the ${script} script`)
      }
    }
  }

// Product-controlled text is English-only. This keeps model-facing metadata,
// UI copy, fixtures, documentation, and vendored runtime text from silently
// introducing a second language surface.
const cyrillic = /[\u0400-\u04ff]/u
const bundledMiniAppNames = []
const bundledPluginManifests = []
const bundledPluginNameByDirectory = new Map()
for (const bundledRoot of bundledRoots(root))
  for (const entry of await readdir(bundledRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      const manifest = readExtensionManifest(join(bundledRoot, entry.name))
      if (typeof manifest.name === 'string') {
        bundledMiniAppNames.push(manifest.name)
        bundledPluginManifests.push(manifest)
        bundledPluginNameByDirectory.set(entry.name, manifest.name)
      }
    } catch {
      // Manifest validation owns malformed plugin reporting. This guard only needs valid identities.
    }
  }

// Identity belongs to the plugin that registers it. Build the forbidden catalog from
// the real bundled register() results instead of a hand-maintained core allowlist. A
// newly registered tool/provider/route/stream command therefore enters this guard in
// the same change even if its author never edits check-architecture.mjs.
const { discoverBundledMiniApps } = await import('../apps/api/src/features/mini-apps/discovery.ts')
const { resolveMiniAppConfig } = await import('../apps/api/src/features/mini-apps/config.ts')
const { inspectMiniAppTools } = await import('../apps/api/src/features/mini-apps/native.ts')
const discoveredPlugins = await discoverBundledMiniApps()
const nativePlugins = discoveredPlugins.filter((plugin) => plugin.backendEntries.length > 0)
const nativeInspections = await Promise.all(
  nativePlugins.map(async (plugin) => ({
    plugin,
    // A fixture home: inspection builds a real context, which creates the plugin's roots, and
    // this check runs on every developer's machine.
    inspection: await inspectMiniAppTools(
      plugin,
      resolveMiniAppConfig(plugin.manifest?.config, undefined),
      {
        userId: 'architecture-audit',
        cwd: plugin.dir,
        homeDir: join(tmpdir(), 'localix-architecture-audit-home'),
      },
    ),
  })),
)
for (const { plugin, inspection } of nativeInspections) {
  if (inspection.error) {
    problems.push(`${plugin.name}: native identity inspection failed (${inspection.error})`)
  }
}

const concretePluginToolNames = new Set(
  nativeInspections.flatMap(({ inspection }) => inspection.tools.map((tool) => tool.name)),
)
const pluginCommandNames = discoveredPlugins.flatMap((app) =>
  app.commands.map((command) =>
    command.name === app.name ? app.name : `${app.name}:${command.name}`,
  ),
)
const pluginAgentNames = discoveredPlugins.flatMap((app) =>
  app.contributions.flatMap((entry) =>
    entry.kind === 'agent' && typeof entry.value?.definition?.handle === 'string'
      ? [`${app.name}:${entry.value.definition.handle}`]
      : [],
  ),
)
// Authoring-only/lazy tools may be declared but not returned by the active register()
// path. Their plugin-owned declarations still define identities core must not learn.
for (const manifest of bundledPluginManifests) {
  const declared = manifest.experimental?.nativeContributions?.tools
  if (!Array.isArray(declared)) continue
  for (const tool of declared) {
    if (typeof tool?.name === 'string') concretePluginToolNames.add(tool.name)
  }
}
for (const file of files) {
  const path = projectPath(file)
  if (!path?.startsWith(MINI_APPS_PREFIX) || /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) {
    continue
  }
  const source = (await readFile(file, 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/.*$/gmu, '$1')
  const definesTool =
    /(?:defineAgentTool|\.defineTool)\s*\(/u.test(source) ||
    (/\binputSchema\b/u.test(source) && /\b(?:async\s+)?execute\s*(?::|\()/u.test(source))
  if (!definesTool) continue
  for (const match of source.matchAll(/^\s*name\s*:\s*['"]([a-z][a-z0-9_]*)['"]/gmu)) {
    concretePluginToolNames.add(match[1])
  }
  const constants = new Map(
    [...source.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*['"]([a-z][a-z0-9_]*)['"]/gu)].map(
      (match) => [match[1], match[2]],
    ),
  )
  for (const match of source.matchAll(/^\s*name\s*:\s*([A-Z][A-Z0-9_]*)\b/gmu)) {
    const value = constants.get(match[1])
    if (value) concretePluginToolNames.add(value)
  }
}

const resourceProviders = nativeInspections.flatMap(
  ({ inspection }) => inspection.resourceProviders,
)
const contextProviders = nativeInspections.flatMap(({ inspection }) => inspection.contextProviders)
const routeMounts = nativeInspections.flatMap(({ inspection }) => inspection.routeMounts)
const wsCommands = nativeInspections.flatMap(({ inspection }) => inspection.wsCommands)
const backendSubsystems = nativeInspections.flatMap(
  ({ inspection }) => inspection.backendSubsystems,
)
const searchProviders = nativeInspections.flatMap(({ inspection }) => inspection.searchProviders)
const channelNames = nativeInspections.flatMap(({ inspection }) => inspection.channels)
const pluginUiContributionIds = new Set()
const pluginUiContributions = []
for (const file of files) {
  const path = projectPath(file)
  if (
    !path?.startsWith(MINI_APPS_PREFIX) ||
    !path.includes('/ui/') ||
    /\.(?:test|spec)\./u.test(path)
  ) {
    continue
  }
  const source = (await readFile(file, 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/.*$/gmu, '$1')
  const pluginDirectory = appOfPath(path)?.app
  const pluginName = bundledPluginNameByDirectory.get(pluginDirectory)
  assert(pluginName, `${path}: bundled plugin directory has no manifest identity`)
  const recordContribution = (id) => {
    pluginUiContributionIds.add(id)
    pluginUiContributions.push({ id, path, pluginName })
  }
  for (const match of source.matchAll(
    /host\.(?:workItems|railSections|railViewlets|search|anchors|fileEditors|statusItems)\.register\(\s*\{\s*(?:\.\.\.[^,\n]+,\s*)?(?:kind|id)\s*:\s*['"]([^'"]+)['"]/gu,
  )) {
    recordContribution(match[1])
  }
  for (const match of source.matchAll(
    /\b(?:export\s+)?const\s+[A-Z][A-Z0-9_]*KIND[A-Z0-9_]*\s*=\s*['"]([^'"]+)['"]/gu,
  )) {
    recordContribution(match[1])
  }
}
problems.push(...pluginUiNamespaceProblems(pluginUiContributions))

assert(nativeInspections.length > 0, 'bundled native-plugin inspection must not be empty')
assert(auxiliaryCoreFiles.length > 0, 'auxiliary core source inspection must not be empty')
assert(concretePluginToolNames.size > 0, 'bundled tool identity catalog must not be empty')
assert(pluginCommandNames.length > 0, 'bundled command identity catalog must not be empty')
assert(routeMounts.length > 0, 'bundled route identity catalog must not be empty')
assert(resourceProviders.length > 0, 'bundled resource identity catalog must not be empty')
assert(contextProviders.length > 0, 'bundled context-provider identity catalog must not be empty')
assert(wsCommands.length > 0, 'bundled websocket identity catalog must not be empty')
// Channels and agents are the capabilities no bundled plugin has to declare — the host keeps the port open
// for an outside-messenger bridge, and agents come from the core presets today. So those catalogs
// may be empty, and their positive controls are skipped rather than fabricated from undefined names.
assert(pluginUiContributionIds.size > 0, 'bundled UI contribution catalog must not be empty')
const pluginIdentityGuard = createPluginIdentityGuard({
  toolNames: concretePluginToolNames,
  commandNames: pluginCommandNames,
  agentNames: pluginAgentNames,
  backendSubsystems,
  routeMounts,
  resourceProviders,
  searchProviders,
  contextProviders,
  wsCommands,
  channelNames,
  pluginNames: bundledMiniAppNames,
  uiContributionIds: pluginUiContributionIds,
})
const identityPositiveControls = [
  `toolName: '${[...concretePluginToolNames][0]}'`,
  `composer.insert('/${pluginCommandNames[0]}')`,
  ...(pluginAgentNames.length > 0 ? [`agentName: '${pluginAgentNames[0]}'`] : []),
  `backendId: '${backendSubsystems[0]}'`,
  `${routeMounts[0]}/health`,
  `localix://resource/${resourceProviders[0]}/item`,
  `searchProviderId: '${searchProviders[0]}'`,
  `providerId: '${contextProviders[0]}'`,
  `messageType: '${wsCommands[0]}'`,
  ...(channelNames.length > 0 ? [`channelName: '${channelNames[0]}'`] : []),
  `pluginName: '${bundledMiniAppNames[0]}'`,
  `workKind: '${[...pluginUiContributionIds][0]}'`,
]
for (const [index, source] of identityPositiveControls.entries()) {
  assert(
    pluginIdentityGuard.inspect(`positive-control-${index}.ts`, source).length > 0,
    `plugin identity positive control ${index} must be detected`,
  )
}
// Relative (`../plugins/x/`), turbo-rooted, or a QUOTED repo-root path (`'plugins/x/…'`). The
// quoted form is how a core contract test once kept a list of files inside six bundled plugins,
// and the relative-only pattern let it through.
const concretePluginTreePattern = new RegExp(
  `(?:(?:\\.\\./)+|\\$TURBO_ROOT\\$/|["'\`])${MINI_APPS_PREFIX}(?:${bundledMiniAppNames.join('|')})/`,
  'u',
)
for (const control of [
  `import x from '../../${MINI_APPS_PREFIX}${bundledMiniAppNames[0]}/ui/x'`,
  `['${MINI_APPS_PREFIX}${bundledMiniAppNames[0]}/ui/X.tsx', 1]`,
]) {
  assert(
    concretePluginTreePattern.test(control),
    `plugin tree positive control must match: ${control}`,
  )
}
// A plugin may own encoding fixture text without teaching this host-side guard its name or path.
// Construct the marker in parts so this guard does not accidentally exempt itself merely by
// defining the token it recognizes.
const cyrillicFixtureMarker = ['@architecture', 'allow-cyrillic-fixture'].join('-')

/**
 * CYRILLIC IS FORBIDDEN, WITH NO WAY TO DECLARE AN EXCEPTION.
 *
 * The rule is that the product's own text is English. It once carried an exemption a file could
 * claim for itself, because the floor engine matched a list of Russian request verbs and the
 * tests that pinned it replayed the recorded lines it was derived from — neither could be
 * translated without deleting what it did.
 *
 * That lexicon is gone. `features/chat/floor/addressing.ts` reads punctuation and position and
 * knows no words, so its rules mean the same in every language and its fixtures mean the same
 * in English. With it went the only honest reason to write Cyrillic here: an encoding fixture
 * needs the BYTES, which `String.fromCodePoint` states exactly, and everything else was prose
 * that had leaked in.
 *
 * So the marker is not a permit any more — it is itself a failure. Left as a rule rather than
 * deleted with the exemption, because a file that still carries the old declaration is a file
 * someone is about to add Cyrillic back to, and the reason it was allowed no longer holds.
 */
function inspectCyrillicDeclaration(path, text) {
  if (!text.includes(cyrillicFixtureMarker)) return null
  return [
    `${path}: the Cyrillic fixture exemption no longer exists — remove the marker, ` +
      'translate the text, and write any byte fixture with String.fromCodePoint',
  ]
}

const controlCyrillic = String.fromCodePoint(0x434, 0x430)
for (const [index, control] of [
  // A declaration with a reason no longer buys anything — refused.
  {
    text: `// ${cyrillicFixtureMarker}: a lexicon lived here once\nconst a = '${controlCyrillic}'`,
    size: 1,
  },
  // Declared bare — refused, as before.
  { text: `// ${cyrillicFixtureMarker}\nconst a = '${controlCyrillic}'`, size: 1 },
  // Declared over nothing — refused, so the marker cannot outlive its fixture.
  { text: `// ${cyrillicFixtureMarker}: was a fixture once`, size: 1 },
  // No marker: the file is read by the line scan below, which is what forbids the letters.
  { text: `const a = '${controlCyrillic}'`, size: null },
].entries()) {
  assert.equal(
    inspectCyrillicDeclaration(`positive-control-${index}.ts`, control.text)?.length ?? null,
    control.size,
    `Cyrillic declaration control ${index} must report ${control.size} problem(s)`,
  )
}
const englishOnlyFiles = (
  await Promise.all(
    ['apps', 'docs', 'packages', ...BUNDLED_DIRS, 'scripts', 'vendor'].map((directory) =>
      englishTextFiles(join(root, directory)),
    ),
  )
).flat()
for (const rootConfig of ['package.json', 'turbo.json', 'bunfig.toml']) {
  const path = join(root, rootConfig)
  if (existsSync(path)) englishOnlyFiles.push(path)
}
for (const file of englishOnlyFiles) {
  const path = projectPath(file)
  if (!path) continue
  const text = await readFile(file, 'utf8')
  const declared = inspectCyrillicDeclaration(path, text)
  if (declared) {
    problems.push(...declared)
    continue
  }
  const lines = text.split(/\r?\n/u)
  const nonSourceCoreText =
    !sourceExtensions.has(extname(path)) &&
    (path === 'package.json' ||
      path === 'turbo.json' ||
      path === 'bunfig.toml' ||
      path.startsWith('apps/') ||
      path.startsWith('packages/') ||
      path.startsWith('scripts/'))
  if (nonSourceCoreText && !/(?:^|\/)(?:__tests__|fixtures?)\//u.test(path)) {
    problems.push(...pluginIdentityGuard.inspect(path, text))
  }
  for (const [index, line] of lines.entries()) {
    if (cyrillic.test(line)) {
      problems.push(`${path}:${index + 1}: Cyrillic text is forbidden; use English project text`)
    }
    if (
      (path.startsWith('apps/') || path.startsWith('packages/')) &&
      concretePluginTreePattern.test(line)
    ) {
      problems.push(
        `${path}:${index + 1}: core references a concrete bundled plugin tree; ` +
          `plugins own their compile/test projects and integration belongs under ${MINI_APPS_PREFIX} or scripts/`,
      )
    }
  }
}

for (const file of files) {
  const path = projectPath(file)
  assert(path)
  const source = await readFile(file, 'utf8')
  // The opt-in screenshot suite is test tooling: it seeds deterministic plugin fixtures the way a
  // test does, and never ships in the host.
  const testSource =
    /(?:^|\/)__tests__\//u.test(path) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path) ||
    path.startsWith('scripts/screenshots/')
  const sourceWithoutComments = source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/.*$/gmu, '$1')
  // The host UI, and the kit its primitives moved into: every host rule below was written for
  // code that now lives in `packages/kit/src`, and scoping them to `apps/ui/src` alone would stop
  // enforcing each one on exactly the primitives it was written for.
  const uiProductionSource =
    (path.startsWith('apps/ui/src/') || path.startsWith('packages/kit/src/')) && !testSource
  // Anything that renders in the BROWSER/webview, wherever it lives: the host UI, a
  // plugin's ui area, and the SDK's ui surface. `uiProductionSource` is host-only, so a
  // rule about escaping the app has to use this or it silently misses every plugin.
  const browserProductionSource =
    !testSource &&
    (path.startsWith('apps/ui/src/') ||
      path.startsWith('packages/kit/src/') ||
      path.startsWith('packages/mini-app-sdk/src/ui/') ||
      pluginPathHasArea(path, 'ui'))
  const coreOrPackageSource =
    path !== 'scripts/check-architecture.mjs' &&
    (path.startsWith('apps/') || path.startsWith('packages/') || path.startsWith('scripts/'))
  const coreOrPackageProductionSource = !testSource && coreOrPackageSource

  if (coreOrPackageSource) {
    problems.push(...pluginIdentityGuard.inspect(path, source))
  }
  if (coreOrPackageProductionSource) {
    if (/Record\s*<\s*WorkItemKind\s*,/u.test(sourceWithoutComments)) {
      problems.push(
        `${path}: core table is keyed by open WorkItemKind; key built-ins by ` +
          'CoreWorkItemKind so contributed kinds cannot leak into core maps',
      )
    }
  }

  if (uiProductionSource) {
    let untrackedMutations
    try {
      untrackedMutations = untrackedRuntimeCapabilityMutationsIn(
        file,
        source,
        auditedRuntimeMutationWrappers.get(path),
      )
    } catch (error) {
      problems.push(`${path}: could not inspect runtime capability mutations (${String(error)})`)
      untrackedMutations = []
    }
    for (const { line, method } of untrackedMutations) {
      problems.push(`${path}:${line}: backendClient.${method} bypasses trackCapabilityWrite`)
    }
  }

  if (!testSource) {
    for (const { column, line, scheme } of removedInternalProviderUrisIn(source)) {
      problems.push(
        `${path}:${line}:${column}: removed internal URI scheme "${scheme}://" is forbidden ` +
          'in production source and comments; use the canonical localix:// address space ' +
          `(typically localix://resource/${scheme}/...)`,
      )
    }
  }

  // A plugin tool description over 4 000 characters (the host's
  // MINI_APP_TOOL_DESCRIPTION_MAX_CHARS) is truncated at load with one server-log
  // line and nothing else. One bundled tool shipped at 6 887, so 2 888 characters —
  // its essential authoring constraints never reached a model. SCOPE: exported
  // `*DESCRIPTION*` template literals only. Descriptions
  // built inline in `register()` are invisible here and stay the owning plugin's
  // job to test; a manifest-reading check would be worse than nothing, since
  // manifests carry tool NAMES and no descriptions at all.
  if (path.startsWith(MINI_APPS_PREFIX) && !testSource) {
    for (const match of source.matchAll(
      /export const (\w*DESCRIPTION\w*)\s*=\s*`((?:[^`\\]|\\.)*)`/gu,
    )) {
      if (match[2].length > 4000) {
        problems.push(
          `${path}: ${match[1]} is ${match[2].length} chars; the host truncates a plugin tool ` +
            'description at 4000 and says so only in a server log — move the overflow into the ' +
            "plugin's instructions context provider",
        )
      }
    }
  }

  // An unbounded microtask spin can wedge the ENTIRE test run with no diagnostic.
  // `await Promise.resolve()` only drains the microtask queue, so it never yields
  // to timers and bun's `--timeout` cannot interrupt it: when the condition stops
  // becoming true the run hangs on one banner line, with no file name and no
  // failing test to point at. Five of these existed; one change that merely
  // stopped calling a mocked method cost 20+ minutes of a hung suite, twice,
  // before the cause was even visible. Bound the spin (`spinUntil`) so the same
  // mistake becomes a named failure in milliseconds.
  if (
    testSource &&
    /while\s*\([^)]*\)\s*(?:\{\s*)?await\s+Promise\.resolve\(\)/u.test(sourceWithoutComments)
  ) {
    problems.push(
      `${path}: unbounded \`while (…) await Promise.resolve()\` can wedge the whole test run; ` +
        'bound the spin and throw a named error instead',
    )
  }

  // `console` is process-wide and `bun test` runs all 1818 files in ONE process, so a
  // spy's window also collects whatever OTHER suites' pending async work logs. Two
  // suites already failed on this — `registryOwnership` went 6 → 18 calls and
  // `cache-volatility-guard` 0 → 1 — on someone else's output, not on a regression in
  // the code under test. Assert on YOUR OWN messages instead:
  //   expect(warn.mock.calls.filter((c) => String(c[0]).includes('[my-prefix]'))).toHaveLength(1)
  // Six instances were converted (git 709e3ca05); this keeps the count at zero.
  if (testSource) {
    const consoleSpies = [
      ...sourceWithoutComments.matchAll(
        /(?:const|let)\s+(\w+)\s*=\s*spyOn\(\s*console\s*,\s*'\w+'/gu,
      ),
    ].map((match) => match[1])
    for (const spy of consoleSpies) {
      const counted = new RegExp(
        `expect\\(\\s*${spy}\\s*\\)\\s*(?:\\.not)?\\.toHaveBeenCalled(?:Times)?\\b`,
        'u',
      )
      if (counted.test(sourceWithoutComments)) {
        problems.push(
          `${path}: \`expect(${spy}).toHaveBeenCalled…\` counts the WHOLE process — other ` +
            "suites' async logs land in the same spy; filter `${spy}.mock.calls` by your own message",
        )
      }
    }
  }

  // Every call to our own API crosses the desktop startup barrier, which lives in
  // ONE place: `apiFetch` (shared/api/internal.ts). The packaged shell paints
  // before its API child binds a port, so a raw `fetch` to API_BASE_URL is a
  // request issued into that gap — it fails, and the caller invents its own error
  // state for a service that was never down. Five call sites were migrated when
  // the barrier landed and four were missed; this is why.
  if (
    uiProductionSource &&
    path !== 'apps/ui/src/shared/api/internal.ts' &&
    /(?<![\w.])fetch\s*\(\s*`\$\{API_BASE_URL\}/u.test(sourceWithoutComments)
  ) {
    problems.push(
      `${path}: raw fetch(\`\${API_BASE_URL}…\`) bypasses the startup barrier; use apiFetch`,
    )
  }

  // Browser persistence is a capability, not an ambient global. Keeping direct
  // calls in one fail-soft adapter makes private mode/SSR behaviour consistent
  // and gives desktop-backed persistence one replacement seam.
  if (
    uiProductionSource &&
    /\blocalStorage\.(?:getItem|setItem|removeItem|clear)\s*\(/u.test(sourceWithoutComments)
  ) {
    problems.push(
      `${path}: direct localStorage access; persist through a fail-soft storage adapter`,
    )
  }

  // OS detection has exactly two sources: the keybinding detector and its
  // platform projection. Components consume those exports instead of probing a
  // deprecated browser global and drifting on mobile/webviews.
  if (
    uiProductionSource &&
    sourceWithoutComments.includes('navigator.platform') &&
    path !== 'packages/kit/src/keyboard/chord.ts' &&
    path !== 'packages/kit/src/lib/platform.ts'
  ) {
    problems.push(`${path}: direct navigator.platform access bypasses the kit's lib/platform`)
  }

  // Global stacking values are named CSS tokens. Local `z-10`-style stacking
  // remains fine; arbitrary numeric utilities and inline numeric zIndex create
  // an undocumented second scale and are rejected.
  if (uiProductionSource && /\bz-\[\d+\]/u.test(sourceWithoutComments)) {
    problems.push(`${path}: arbitrary numeric z-index must use a named --z-* token`)
  }
  if (uiProductionSource && /\bzIndex\s*:\s*\d+/u.test(sourceWithoutComments)) {
    problems.push(`${path}: inline numeric zIndex must use a named --z-* token`)
  }
  if (
    uiProductionSource &&
    path !== 'apps/ui/src/shared/lib/platformCapabilities.ts' &&
    /\bnavigator\.clipboard(?:\?\.|\.)?(?:writeText|readText|write)\s*\(/u.test(
      sourceWithoutComments,
    )
  ) {
    problems.push(`${path}: direct clipboard access bypasses platformCapabilities`)
  }
  // `window.open` is how a link escapes the app WITHOUT the confirmation gate, and
  // inside the desktop shell WKWebView swallows it, so the link silently does
  // nothing. `openExternal.ts` owns the one sanctioned call; everything else asks
  // through `platformCapabilities().external.open` (plugins: `miniAppExternal`).
  if (
    browserProductionSource &&
    path !== 'apps/ui/src/shared/lib/openExternal.ts' &&
    /\bwindow\.open\s*\(/u.test(sourceWithoutComments)
  ) {
    problems.push(`${path}: window.open bypasses the external-link gate`)
  }
  // The OTHER half of the same rule, for the surfaces that have a process instead
  // of a webview. `open` / `xdg-open` / `cmd /c start` / `explorer` spawned inline
  // is how one table came to exist three times, each with its own answer to
  // "does a failure reach anyone?" — and mostly the answer was no. `@localixai/os-open`
  // owns the table and the reporting; the desktop shell owns the Rust equivalent
  // for URLs, which no JS rule can see.
  const spawnsOsOpener =
    /\b(?:spawn|spawnSync|exec|execFile|execFileSync|execSync)\s*\(\s*['"`](?:open|xdg-open|explorer)['"`]/u.test(
      sourceWithoutComments,
    ) ||
    /['"`]xdg-open['"`]/u.test(sourceWithoutComments) ||
    /['"`]\/c['"`]\s*,\s*['"`]start['"`]/u.test(sourceWithoutComments) ||
    /['"`]url\.dll,FileProtocolHandler['"`]/u.test(sourceWithoutComments)
  if (
    !testSource &&
    coreOrPackageSource &&
    !path.startsWith('packages/os-open/') &&
    spawnsOsOpener
  ) {
    problems.push(
      `${path}: spawning an OS opener directly bypasses @localixai/os-open ` +
        '(performHandoff), which is what makes a failed handoff visible',
    )
  }
  if (
    uiProductionSource &&
    path !== 'apps/ui/src/shared/lib/platformCapabilities.ts' &&
    /\bwindow\.location\.reload\s*\(/u.test(sourceWithoutComments)
  ) {
    problems.push(`${path}: direct reload bypasses platformCapabilities`)
  }
  // The inspector's native browser and the companion island reach the shell through the
  // capability port, so a host or test can supply the bridge.
  if (
    uiProductionSource &&
    /^apps\/ui\/src\/(?:features\/(?:inspector|companion)|pages\/companion)\//u.test(path) &&
    /from\s+['"]@\/shared\/lib\/tauri['"]/u.test(sourceWithoutComments)
  ) {
    problems.push(`${path}: desktop bridge import bypasses platformCapabilities().desktop`)
  }

  let moduleLoads
  try {
    moduleLoads = moduleLoadsIn(file, source)
  } catch (error) {
    problems.push(`${path}: could not inspect imports (${String(error)})`)
    continue
  }
  const specifiers = moduleLoads.specifiers
  const pluginMatch = appOfPath(path)
  if (pluginMatch && !testSource) {
    for (const { kind, start } of moduleLoads.nonLiteral) {
      const line = source.slice(0, start).split('\n').length
      problems.push(
        `${path}:${line}: production plugin uses non-literal ${kind}(); use an explicit ` +
          'module specifier so dependency and host-boundary checks can inspect it',
      )
    }
  }

  // A DOM test must not import react-dom at MODULE scope.
  //
  // bun evaluates every test file's module graph before any registration hook runs, so a
  // static `react-dom/client` import initializes react-dom outside the window in which
  // `registerDom()` has happy-dom installed. Measured cost when
  // a preview DOM test in apps/ui/src/features/inspector did this: running
  // `bun test src/features/inspector src/features/source-control` failed
  // `CommitBox.dom.test.tsx` — React synthetic events stopped arriving there entirely — in
  // either file order, while each file passed alone. The full suite stayed green, which is
  // what made it expensive: it only breaks the targeted runs everyone actually iterates with.
  //
  // 24 of the 26 DOM tests already load it as `await import('react-dom/client')` inside the
  // test body. This keeps the other two from drifting back.
  if (/\.(?:dom\.)?test\.[cm]?[jt]sx?$/u.test(path) && source.includes('registerDom(')) {
    let staticSpecifiers
    try {
      staticSpecifiers = staticImportsIn(file, source)
    } catch {
      staticSpecifiers = []
    }
    for (const specifier of staticSpecifiers) {
      // `react-dom/client` and the bare package that re-exports it. NOT `react-dom/server`:
      // that renders to a string and attaches nothing to a document, and the failure above was
      // never observed for it — a rule wider than its evidence would just force churn.
      if (specifier === 'react-dom' || specifier === 'react-dom/client') {
        problems.push(
          `${path}: a DOM test statically imports ${specifier} — load it inside the test ` +
            `(\`await import('react-dom/client')\`) so react-dom initializes after registerDom()`,
        )
      }
    }
  }

  for (const specifier of specifiers) {
    const target = relativeTarget(file, specifier)
    const browserUiSource =
      path.startsWith('apps/ui/src/') ||
      path.startsWith('packages/kit/src/') ||
      path.startsWith('apps/landing/src/') ||
      path.startsWith('packages/mini-app-sdk/src/ui/') ||
      pluginPathHasArea(path, 'ui')
    if (
      uiProductionSource &&
      /(?:^|\/)openExternal$/u.test(specifier) &&
      path !== 'apps/ui/src/shared/lib/platformCapabilities.ts' &&
      // The confirmation gate IS the port's implementation: `platformCapabilities`
      // delegates `external.open` to it, and it calls `openExternal` only after the
      // person has said yes. Routing it back through the port would be a cycle.
      path !== 'apps/ui/src/shared/lib/externalLink.ts'
    ) {
      problems.push(`${path}: direct openExternal import bypasses platformCapabilities`)
    }
    if (
      browserUiSource &&
      !pluginMatch &&
      specifier.startsWith('@localixai/mini-app-sdk/backend')
    ) {
      problems.push(
        `${path}: browser UI imports the Node-only plugin SDK backend barrel; use ` +
          '@localixai/mini-app-sdk/ui or a narrow browser-safe entrypoint',
      )
    }
    const workspaceMatch = workspacePathPattern.exec(path)
    const importedWorkspacePackage = localWorkspacePackageName(specifier)
    if (workspaceMatch && importedWorkspacePackage) {
      const workspaceDirectory = `${workspaceMatch[1]}/${workspaceMatch[2]}`
      const manifest = workspaceManifests.get(workspaceDirectory)
      if (
        manifest &&
        importedWorkspacePackage !== manifest.name &&
        !manifest.declared.has(importedWorkspacePackage)
      ) {
        problems.push(
          `${path}: ${importedWorkspacePackage} is used without being declared by ${workspaceDirectory}`,
        )
      }
    }
    if (pluginMatch && !testSource) {
      const workspaceProblem = miniAppWorkspaceImportProblem(specifier)
      if (workspaceProblem) problems.push(`${path}: ${workspaceProblem}`)
      const sdkLayerProblem = miniAppSdkLayerProblem(path, specifier)
      if (sdkLayerProblem) problems.push(`${path}: ${sdkLayerProblem}`)
    }

    const packageMatch = /^packages\/([^/]+)\//u.exec(path)
    const kitProblem = kitBoundaryProblem(path, specifier, appPackageNames)
    if (kitProblem) {
      // Tests too: the kit runs its own suite from its own package, where `@/` means nothing.
      problems.push(`${path}: ${kitProblem}`)
    } else if (packageMatch) {
      if (target?.startsWith('apps/') || target?.startsWith(MINI_APPS_PREFIX)) {
        problems.push(`${path}: package crosses into ${target} through a relative import`)
      }
    }

    // The host discovers and composes plugins from manifests and the public SDK
    // contracts. A source import into one concrete plugin would make that plugin
    // part of the host's compile-time architecture and silently bypass discovery,
    // enablement, and isolation. Tests may import fixtures explicitly; production
    // host code may not.
    if (coreOrPackageProductionSource && target?.startsWith(MINI_APPS_PREFIX)) {
      problems.push(
        `${path}: host imports concrete plugin source (${target}); compose it through ` +
          'plugin discovery and @localixai/mini-app-sdk contracts',
      )
    }

    if (path.startsWith('packages/agent/')) {
      if (target && !target.startsWith('packages/agent/')) {
        problems.push(`${path}: the agnostic agent crosses its package boundary into ${target}`)
      }
      if (specifier.startsWith('@localixai/')) {
        problems.push(`${path}: the agnostic agent imports engine/host module ${specifier}`)
      }
    }

    const engineLayer = ENGINE_LAYERS.find((layer) => path.startsWith(layer.root))
    if (engineLayer) {
      if (target && !target.startsWith(engineLayer.root)) {
        problems.push(
          `${path}: the ${engineLayer.name} layer crosses its package boundary into ${target}`,
        )
      }
      const importedPackage = localWorkspacePackageName(specifier)
      if (importedPackage && !engineLayer.workspace.includes(importedPackage)) {
        problems.push(
          `${path}: the ${engineLayer.name} layer may import ${engineLayer.workspace.join(', ')} only, not ${specifier}`,
        )
      }
      const banned = engineLayer.forbidden?.find((pattern) => pattern.test(specifier))
      if (banned) {
        problems.push(
          `${path}: the ${engineLayer.name} layer must not know ${specifier} (${engineLayer.why})`,
        )
      }
    }

    const targetPluginMatch = target ? appOfPath(target) : null
    if (!pluginMatch && !testSource && specifier.startsWith('@localix-mini-app/')) {
      problems.push(
        `${path}: host/package imports concrete plugin package ${specifier}; compose it through ` +
          'plugin discovery and @localixai/mini-app-sdk contracts',
      )
    }
    if (
      pluginMatch &&
      targetPluginMatch &&
      pluginMatch.app !== targetPluginMatch.app &&
      !testSource
    ) {
      problems.push(
        `${path}: plugin ${pluginMatch.app} imports sibling plugin ${targetPluginMatch.app}`,
      )
    }
    if (
      pluginMatch &&
      !testSource &&
      (target?.startsWith('apps/') ||
        target?.startsWith('packages/') ||
        target?.startsWith('scripts/'))
    ) {
      problems.push(
        `${path}: plugin imports workspace internals (${target}); use an approved public ` +
          'workspace package, @localixai/mini-app-sdk, or inject host-owned behavior through MiniAppContext',
      )
    }
    // Tests too: they reach the host through `@localixai/kit/testing`, never `@/`.
    if (pluginMatch) {
      const hostProblem = miniAppHostBoundaryProblem(path, specifier)
      if (hostProblem) {
        const edge = `${path} -> ${specifier}`
        observedPluginKitEdges.add(edge)
        if (!pluginKitDebt.has(edge)) problems.push(`${path}: ${hostProblem}`)
      }
    }

    if (
      path.startsWith('apps/api/src/') &&
      !path.endsWith('.test.ts') &&
      !path.endsWith('.integration.test.ts') &&
      specifier.startsWith('@localixai/engine') &&
      // The composition root is `bootstrap.ts` PLUS the `bootstrap/` phase modules it
      // was split into — that split is about file size, not about who may wire the engine.
      // Everything else under apps/api/src/ must go through the runtime-agnostic seam
      // (`@localixai/agent/runtime`), which is what this rule is actually protecting.
      path !== 'apps/api/src/bootstrap.ts' &&
      !path.startsWith('apps/api/src/bootstrap/')
    ) {
      problems.push(`${path}: only the API composition root may import the engine`)
    }

    // A relative path that LEAVES apps/ui/src. The FSD rule below cannot see this
    // one: `uiTarget` returns null for anything outside the UI, so the layer check
    // silently skips it — and what it skips is the import that should not exist at
    // all. The UI reaches the API through the declared export-map leaves
    // (`@localixai/api/tool-names`, `.../wake-provenance`), which is what keeps
    // that surface small and reviewable; `../../../../api/src/...` bypasses the map
    // entirely and nothing else in the gate objects — not lint, not type-check.
    if (path.startsWith('apps/ui/src/') && specifier.startsWith('.')) {
      const escaped = relativeTarget(file, specifier)
      // Scoped to apps/api deliberately. `plugins/*/ui/**` is also reached by
      // relative path from a few warm-* dom tests, but apps/ui does not depend on
      // the plugin packages, so a name import is not available to them and calling
      // that a violation would be asserting something I have not established.
      if (escaped?.startsWith('apps/api/')) {
        problems.push(
          `${path}: relative import reaches into apps/api (${specifier}) — use a declared export-map leaf on @localixai/api`,
        )
      }
    }

    const importerLayer = uiLayer(path)
    const targetLayer = uiLayer(uiTarget(file, specifier) ?? '')
    if (importerLayer && targetLayer && targetLayer.rank > importerLayer.rank) {
      problems.push(
        `${path}: FSD ${importerLayer.layer} cannot import outward from ${targetLayer.layer} (${specifier})`,
      )
    }
  }
}

// Desktop-native host code is outside the TypeScript import graph, but it is still
// core and must obey the same semantic boundary. Keep its identity scan separate so
// the JS parser is never asked to parse Rust.
for (const file of auxiliaryCoreFiles) {
  const path = projectPath(file)
  assert(path)
  const source = await readFile(file, 'utf8')
  problems.push(...pluginIdentityGuard.inspect(path, source))
}

for (const [edge, reason] of pluginKitDebt) {
  if (!observedPluginKitEdges.has(edge)) {
    problems.push(`stale plugin host-feature kit allowance: ${edge} (${reason})`)
  }
}

// Every independently named UI boundary must declare addressability metadata
// beside its component. The declaration is either a strict Localix URI surface
// or an explicit contextual/non-publishable reason; forgetting it is a CI error.
const uiSurfaceFilenameBoundary = /(?:Page|Tab|Panel|Sidebar|Picker|Switcher|Palette)\.tsx$/u
for (const file of files) {
  const path = projectPath(file)
  if (
    !path?.startsWith('apps/ui/src/') ||
    extname(path) !== '.tsx' ||
    /\.(?:dom\.)?test\.tsx$/u.test(path) ||
    path.endsWith('.surface.tsx')
  ) {
    continue
  }
  let boundaryNames
  try {
    boundaryNames = namedUiBoundariesIn(file, await readFile(file, 'utf8'))
  } catch (error) {
    problems.push(`${path}: could not inspect named UI boundaries (${String(error)})`)
    continue
  }
  if (!uiSurfaceFilenameBoundary.test(path) && boundaryNames.length === 0) continue
  const stem = file.slice(0, -'.tsx'.length)
  if (!existsSync(`${stem}.surface.ts`) && !existsSync(`${stem}.surface.tsx`)) {
    const semanticDetail =
      boundaryNames.length > 0 ? ` (${boundaryNames.join(', ')})` : ' (filename boundary)'
    problems.push(
      `${path}: UI surface boundary${semanticDetail} is missing a co-located *.surface descriptor`,
    )
  }
}

assert.deepEqual(
  problems,
  [],
  `Architecture checks found ${problems.length} violation(s):\n${problems.join('\n')}`,
)

console.log(
  `[architecture] ${files.length} JS/TS and ${auxiliaryCoreFiles.length} Rust source files respect ` +
    'package, plugin, runtime, UI, storage, platform, and stacking boundaries.',
)
console.log(
  `[architecture] Derived ${concretePluginToolNames.size} tools, ${backendSubsystems.length} backends, ` +
    `${routeMounts.length} routes, ${resourceProviders.length} resources, ` +
    `${searchProviders.length} search providers, ${contextProviders.length} context providers, ` +
    `${wsCommands.length} websocket commands, ${pluginCommandNames.length} slash commands, ` +
    `${pluginAgentNames.length} agents, ` +
    `${channelNames.length} channels, and ` +
    `${pluginUiContributionIds.size} UI contribution ids from bundled mini apps.`,
)

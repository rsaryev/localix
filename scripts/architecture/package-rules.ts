import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join } from 'node:path'
import { addEdge, cyclicEdges, importsOf, repoRoot, type Rule, type Source } from './kit'

/** Package rules: A1 (no package cycle), A2 (agnostic core), A3 (provider SDKs in one package). */

const PROVIDER_SDK = [/^ai(?:\/|$)/u, /^@ai-sdk\//u, /^@openrouter\//u, /^@opencode-ai\//u]
export const isProviderSdk = (spec: string) => PROVIDER_SDK.some((pattern) => pattern.test(spec))

const NODE_BUILTINS = new Set(builtinModules)
const CORE_FORBIDDEN: ReadonlyArray<[RegExp, string]> = [
  [/^react(?:-dom)?(?:\/|$)/u, 'React'],
  [/^hono(?:\/|$)/u, 'Hono'],
  [/^kysely(?:\/|$)/u, 'Kysely'],
  [/^bun:sqlite$/u, 'bun:sqlite'],
  [/^node:/u, 'Node built-in'],
]

/** Every workspace package manifest, as a source whose `raw` is the JSON. */
export function loadManifests(): Source[] {
  const manifests: Source[] = []
  for (const group of ['apps', 'packages', 'plugins']) {
    for (const name of readdirSync(join(repoRoot, group))) {
      const file = `${group}/${name}/package.json`
      const path = join(repoRoot, file)
      if (!existsSync(path)) continue
      const raw = readFileSync(path, 'utf8')
      manifests.push({ file, raw, code: raw })
    }
  }
  return manifests
}

type Manifest = { name: string } & Partial<Record<DependencyField, Record<string, string>>>
type DependencyField = 'dependencies' | 'peerDependencies' | 'devDependencies'
const DEPENDENCY_FIELDS: DependencyField[] = ['dependencies', 'peerDependencies', 'devDependencies']

export const A1_PACKAGE_CYCLES: Rule = {
  id: 'A1',
  fix: 'break the package cycle: move the shared piece down into a lower package, or invert it behind a port',
  detect(manifests) {
    const packages = manifests.map((source) => JSON.parse(source.raw) as Manifest)
    const names = new Set(packages.map((manifest) => manifest.name))
    const graph = new Map<string, Set<string>>()
    for (const manifest of packages) {
      graph.set(manifest.name, graph.get(manifest.name) ?? new Set())
      for (const field of DEPENDENCY_FIELDS) {
        for (const dependency of Object.keys(manifest[field] ?? {})) {
          if (names.has(dependency)) addEdge(graph, manifest.name, dependency)
        }
      }
    }
    return cyclicEdges(graph).map((edge) => `package cycle ${edge}`)
  },
}

const CORE_ROOTS = ['packages/agent/src/', 'packages/engine-loop/src/']

export const A2_AGNOSTIC_CORE: Rule = {
  id: 'A2',
  fix: 'declare a port in the core and implement it in an adapter package (engine-models, apps/api)',
  detect(sources) {
    const found: string[] = []
    for (const source of sources) {
      if (!CORE_ROOTS.some((root) => source.file.startsWith(root))) continue
      for (const { spec } of importsOf(source)) {
        const banned =
          CORE_FORBIDDEN.find(([pattern]) => pattern.test(spec))?.[1] ??
          (NODE_BUILTINS.has(spec) ? 'Node built-in' : isProviderSdk(spec) ? 'provider SDK' : null)
        if (banned) found.push(`${source.file} imports ${spec} (${banned})`)
      }
    }
    return found
  },
}

export const A3_PROVIDER_SDK_HOME: Rule = {
  id: 'A3',
  fix: 'reach the provider through @localixai/engine-models (or a port it implements), not its SDK',
  detect(sources) {
    const found: string[] = []
    for (const source of sources) {
      if (source.file.startsWith('packages/engine-models/')) continue
      for (const { spec } of importsOf(source)) {
        if (isProviderSdk(spec)) found.push(`${source.file} imports ${spec}`)
      }
    }
    return found
  },
}

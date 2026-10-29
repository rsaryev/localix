import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { isRecord } from '../../lib/record'

/**
 * WHAT THE OPEN PROJECT IS WRITTEN IN, read cheaply for the Store's project boost
 * (`docs/internals/store-scale.md`, "Ranking"): the names at its root (a `Cargo.toml` is Rust, a
 * `Dockerfile` is Docker) and the packages its `package.json` names, each as the word a listing
 * about it would use; and the same names as they are written, for what a package says it is for
 * (`recommend-rules.ts`). One directory listing and at most one small file per project, kept for a
 * few minutes. Nothing else in Localix detects a project's languages (the language servers pick a
 * server per file).
 */

/** A file or folder at the root, and what it says the project uses. */
const MARKERS: ReadonlyArray<[RegExp, readonly string[]]> = [
  [/^package\.json$/, ['javascript', 'node']],
  [/^tsconfig(\.[\w-]+)?\.json$/, ['typescript']],
  [/^deno\.jsonc?$/, ['deno', 'typescript']],
  [/^Cargo\.toml$/, ['rust']],
  [/^go\.mod$/, ['go']],
  [/^(pyproject\.toml|requirements\.txt|setup\.py|Pipfile)$/, ['python']],
  [/^Gemfile$/, ['ruby']],
  [/^(pom\.xml|build\.gradle)$/, ['java']],
  [/^build\.gradle\.kts$/, ['kotlin']],
  [/^composer\.json$/, ['php']],
  [/\.(csproj|sln)$/, ['csharp', 'dotnet']],
  [/^Package\.swift$/, ['swift']],
  [/^(Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/, ['docker']],
  [/\.tf$/, ['terraform']],
  [/^(Chart\.yaml|kustomization\.ya?ml)$/, ['kubernetes']],
  [/^\.github$/, ['github']],
  [/^\.gitlab-ci\.yml$/, ['gitlab']],
]

/** Well-known packages whose name is not the word a listing would use for them. */
const PACKAGES: Readonly<Record<string, string>> = {
  react: 'react',
  next: 'nextjs',
  vue: 'vue',
  svelte: 'svelte',
  '@angular/core': 'angular',
  tailwindcss: 'tailwind',
  prisma: 'prisma',
  pg: 'postgres',
  postgres: 'postgres',
  mysql2: 'mysql',
  mongodb: 'mongodb',
  redis: 'redis',
  '@supabase/supabase-js': 'supabase',
  stripe: 'stripe',
  playwright: 'playwright',
  '@playwright/test': 'playwright',
  vitest: 'vitest',
  jest: 'jest',
  typescript: 'typescript',
}

/** First words of package names that say nothing of what a project uses. */
const GENERIC = new Set(['class', 'date', 'is', 'get', 'use', 'fast', 'cross', 'dot', 'web'])
/** Words one manifest adds at most: the project's interest stays about the project. */
const PACKAGE_WORDS = 24

/**
 * The word a package says the project uses: a well-known one's own word, a scoped one's scope
 * (`@sentry/node` is Sentry), else the first part of its name (`drizzle-orm` is Drizzle). Type
 * packages and generic first words say nothing.
 */
function wordOf(name: string): string | null {
  if (PACKAGES[name]) return PACKAGES[name]
  if (name.startsWith('@types/')) return null
  const word = (name.startsWith('@') ? name.slice(1).split('/')[0]! : name)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)[0]
  return word && word.length >= 3 && !GENERIC.has(word) ? word : null
}

/** The packages a manifest names, as it writes them. */
async function packagesOf(file: string): Promise<string[]> {
  try {
    const json = JSON.parse(await fs.readFile(file, 'utf8')) as unknown
    if (!isRecord(json)) return []
    return [
      ...new Set(
        ['dependencies', 'devDependencies', 'peerDependencies'].flatMap((field) =>
          isRecord(json[field]) ? Object.keys(json[field] as Record<string, unknown>) : [],
        ),
      ),
    ]
  } catch {
    return []
  }
}

/** What the project has, as it is written: the names at its root and its dependencies. */
export interface ProjectFacts {
  files: string[]
  dependencies: string[]
}

const NO_FACTS: ProjectFacts = { files: [], dependencies: [] }

async function read(dir: string): Promise<ProjectFacts> {
  const files = await fs.readdir(dir).catch(() => [] as string[])
  const dependencies = files.includes('package.json')
    ? await packagesOf(join(dir, 'package.json'))
    : []
  return { files, dependencies }
}

/** The words the facts say a listing about the project would use. */
export function wordsOf(facts: ProjectFacts): Set<string> {
  const found = new Set<string>()
  for (const name of facts.files)
    for (const [pattern, words] of MARKERS)
      if (pattern.test(name)) for (const word of words) found.add(word)
  const packages = [...new Set(facts.dependencies.flatMap((name) => wordOf(name) ?? []))]
  for (const word of packages.slice(0, PACKAGE_WORDS)) found.add(word)
  return found
}

const FRESH_MS = 5 * 60 * 1000

export function createProjectSignals(deps: {
  /** The project's folder, or null when it has none. */
  projectDir: (userId: string, projectId: string) => Promise<string | null>
  now?: () => number
}) {
  const now = deps.now ?? Date.now
  const cache = new Map<string, { at: number; facts: Promise<ProjectFacts> }>()
  async function facts(userId: string, projectId: string | null | undefined) {
    if (!projectId) return NO_FACTS
    const key = `${userId}\u0000${projectId}`
    const held = cache.get(key)
    if (held && now() - held.at < FRESH_MS) return held.facts
    const reading = deps
      .projectDir(userId, projectId)
      .then((dir) => (dir ? read(dir) : NO_FACTS))
      .catch(() => NO_FACTS)
    cache.set(key, { at: now(), facts: reading })
    return reading
  }
  return {
    /** The words the open project matches a listing by; empty without a project. */
    of: async (userId: string, projectId: string | null | undefined) =>
      wordsOf(await facts(userId, projectId)),
    /** What the open project has, as it is written (`recommend-rules.ts`); empty without one. */
    facts,
  }
}

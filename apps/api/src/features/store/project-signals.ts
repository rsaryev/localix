import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { isRecord } from '../../lib/record'

/**
 * WHAT THE OPEN PROJECT IS WRITTEN IN, read cheaply for the Store's project boost
 * (`docs/internals/store-scale.md`, "Ranking"): the names at its root (a `Cargo.toml` is Rust, a
 * `Dockerfile` is Docker) and the packages its `package.json` names that a listing might be for.
 * One directory listing and at most one small file per project, kept for a few minutes. Nothing
 * else in Localix detects a project's languages (the language servers pick a server per file).
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

/** Packages a `package.json` may name, and the word a listing would use for each. */
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

async function packagesOf(file: string): Promise<string[]> {
  try {
    const json = JSON.parse(await fs.readFile(file, 'utf8')) as unknown
    if (!isRecord(json)) return []
    const names = ['dependencies', 'devDependencies', 'peerDependencies'].flatMap((field) =>
      isRecord(json[field]) ? Object.keys(json[field] as Record<string, unknown>) : [],
    )
    return names.flatMap((name) => (PACKAGES[name] ? [PACKAGES[name]] : []))
  } catch {
    return []
  }
}

async function read(dir: string): Promise<Set<string>> {
  const names = await fs.readdir(dir).catch(() => [] as string[])
  const found = new Set<string>()
  for (const name of names)
    for (const [pattern, words] of MARKERS)
      if (pattern.test(name)) for (const word of words) found.add(word)
  if (names.includes('package.json'))
    for (const word of await packagesOf(join(dir, 'package.json'))) found.add(word)
  return found
}

const FRESH_MS = 5 * 60 * 1000

export function createProjectSignals(deps: {
  /** The project's folder, or null when it has none. */
  projectDir: (userId: string, projectId: string) => Promise<string | null>
  now?: () => number
}) {
  const now = deps.now ?? Date.now
  const cache = new Map<string, { at: number; signals: Promise<Set<string>> }>()
  return {
    /** The words the open project matches a listing by; empty without a project. */
    async of(userId: string, projectId: string | null | undefined): Promise<Set<string>> {
      if (!projectId) return new Set()
      const key = `${userId}\u0000${projectId}`
      const held = cache.get(key)
      if (held && now() - held.at < FRESH_MS) return held.signals
      const signals = deps
        .projectDir(userId, projectId)
        .then((dir) => (dir ? read(dir) : new Set<string>()))
        .catch(() => new Set<string>())
      cache.set(key, { at: now(), signals })
      return signals
    },
  }
}

export type ProjectSignals = ReturnType<typeof createProjectSignals>

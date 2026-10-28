import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  lockMatches,
  NPM_INSTALL_FLAGS,
  npmManifest,
  SHIPPED_LOCKS,
  type LockfileMap,
  type NpmManifest,
} from '../src/features/lsp/lsp-npm-lock'
import {
  formatSource,
  lspPackage,
  parseSource,
  type LspAsset,
  type LspRegistryEntry,
  type LspSource,
} from '../src/features/lsp/lsp-registry'

/**
 * `bun run --cwd apps/api lsp:update`: moves every language server in `language-servers.json`
 * to its newest stable release that is at least a week old (a hijacked release is usually caught
 * within days), never to an older one, and within any `hold`. npm versions come from the npm
 * registry, Go modules from the Go proxy, GitHub releases with each platform asset's size and
 * sha256. It then locks every npm server's whole dependency tree (`lsp-npm-lock.ts`): a lockfile
 * is resolved again only when it is missing or its pinned versions moved, so an update that leaves a
 * server alone leaves its transitive packages alone. Review the diff and run the LSP tests before
 * committing it.
 */

export interface LspRegistry {
  $comment: string
  servers: Record<string, LspRegistryEntry>
}

interface UpdateOptions {
  fetchImpl?: typeof fetch
  now?: Date
  /** Days a release must have been out. */
  minAgeDays?: number
}

const bare = (version: string) => version.replace(/^v/, '')
const isStable = (version: string) => !bare(version).includes('-')
const newer = (a: string, b: string) => Bun.semver.order(bare(a), bare(b)) > 0

export async function updateRegistry(
  registry: LspRegistry,
  options: UpdateOptions = {},
): Promise<{ registry: LspRegistry; changes: string[] }> {
  const get = options.fetchImpl ?? fetch
  const cutoff = (options.now ?? new Date()).getTime() - (options.minAgeDays ?? 7) * 86_400_000
  const oldEnough = (at: string | undefined) => at !== undefined && Date.parse(at) <= cutoff
  const changes: string[] = []

  async function json<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
    const res = await get(url, { headers })
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    return (await res.json()) as T
  }

  async function npm(name: string, current: string, range?: string): Promise<string> {
    const doc = await json<{ versions: Record<string, unknown>; time: Record<string, string> }>(
      `https://registry.npmjs.org/${name.replace('/', '%2F')}`,
    )
    let best = current
    for (const version of Object.keys(doc.versions)) {
      if (!isStable(version) || !oldEnough(doc.time[version]) || !newer(version, best)) continue
      if (range && !Bun.semver.satisfies(version, range)) continue
      best = version
    }
    return best
  }

  async function golang(module: string, current: string): Promise<string> {
    // The proxy escapes capitals as `!` + lowercase.
    const base = `https://proxy.golang.org/${module.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`)}/@v`
    const res = await get(`${base}/list`)
    if (!res.ok) throw new Error(`${base}/list: HTTP ${res.status}`)
    const candidates = (await res.text())
      .split('\n')
      .map((line) => line.trim())
      .filter((version) => version && isStable(version) && newer(version, current))
      .sort((a, b) => Bun.semver.order(bare(b), bare(a)))
    for (const version of candidates) {
      const info = await json<{ Time: string }>(`${base}/${version}.info`)
      if (oldEnough(info.Time)) return version
    }
    return current
  }

  interface Release {
    tag_name: string
    draft: boolean
    prerelease: boolean
    published_at: string
    assets?: { name: string; size: number; digest?: string; browser_download_url: string }[]
  }

  async function github(repo: string, current: string, assets: Record<string, LspAsset>) {
    const token = process.env.GITHUB_TOKEN
    const releases = await json<Release[]>(
      `https://api.github.com/repos/${repo}/releases?per_page=30`,
      {
        accept: 'application/vnd.github+json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    )
    // Newest first: reaching the pinned tag means nothing older is taken.
    const pinnedAt = releases.findIndex((each) => each.tag_name === current)
    const release = (pinnedAt === -1 ? releases : releases.slice(0, pinnedAt)).find(
      (each) => !each.draft && !each.prerelease && oldEnough(each.published_at),
    )
    if (!release) return { version: current, assets }
    const next: Record<string, LspAsset> = {}
    for (const [platform, pinned] of Object.entries(assets)) {
      const found = release.assets?.find((each) => each.name === pinned.file)
      if (!found) throw new Error(`${repo} ${release.tag_name} has no ${pinned.file}`)
      let sha256 = found.digest?.startsWith('sha256:') ? found.digest.slice(7) : undefined
      if (!sha256) {
        const res = await get(found.browser_download_url)
        if (!res.ok) throw new Error(`${found.browser_download_url}: HTTP ${res.status}`)
        sha256 = new Bun.CryptoHasher('sha256').update(await res.arrayBuffer()).digest('hex')
      }
      next[platform] = { file: pinned.file, bytes: found.size, sha256 }
    }
    return { version: release.tag_name, assets: next }
  }

  const servers: Record<string, LspRegistryEntry> = {}
  for (const [id, entry] of Object.entries(registry.servers)) {
    const moved = (from: LspSource, version: string): string => {
      if (version !== from.version) {
        const name =
          from.type === 'npm' ? from.name : from.type === 'github' ? from.repo : from.module
        changes.push(`${id}: ${name} ${from.version} → ${version}`)
      }
      return formatSource({ ...from, version })
    }
    const source = parseSource(entry.source)
    const next: LspRegistryEntry = { ...entry }
    if (source.type === 'npm')
      next.source = moved(source, await npm(source.name, source.version, entry.hold?.[source.name]))
    else if (source.type === 'golang')
      next.source = moved(source, await golang(source.module, source.version))
    else {
      const release = await github(source.repo, source.version, entry.assets ?? {})
      next.source = moved(source, release.version)
      next.assets = release.assets
    }
    if (entry.with) {
      next.with = []
      for (const purl of entry.with) {
        const extra = parseSource(purl)
        if (extra.type !== 'npm') throw new Error(`${id}: only npm packages go beside a server`)
        next.with.push(moved(extra, await npm(extra.name, extra.version, entry.hold?.[extra.name])))
      }
    }
    servers[id] = next
  }
  return { registry: { ...registry, servers }, changes }
}

export interface RelockOptions {
  /** The lockfiles as they are now; defaults to the shipped ones. */
  current?: LockfileMap
  /** Resolve a manifest's whole tree into the text of a `bun.lock`. */
  resolve?: (manifest: NpmManifest) => Promise<string>
}

/** Resolve with Bun in a scratch folder, with the flags the installer will install with. */
async function resolveWithBun(manifest: NpmManifest): Promise<string> {
  const work = await mkdtemp(path.join(tmpdir(), 'localix-lsp-lock-'))
  try {
    await writeFile(path.join(work, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    // Not `--production`: Bun writes no lockfile in that mode.
    const proc = Bun.spawn([process.execPath, 'install', '--lockfile-only', ...NPM_INSTALL_FLAGS], {
      cwd: work,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [output, code] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
      new Response(proc.stdout).text(),
    ])
    if (code !== 0)
      throw new Error(`${manifest.name}: bun install --lockfile-only failed\n${output}`)
    return await readFile(path.join(work, 'bun.lock'), 'utf8')
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

/**
 * The lockfile of each npm server: kept while it still matches the pinned versions, resolved again
 * when it is missing or its pins moved, and absent for a server that is gone. `changed` names the
 * servers that were resolved.
 */
export async function relockRegistry(
  registry: LspRegistry,
  { current = SHIPPED_LOCKS, resolve = resolveWithBun }: RelockOptions = {},
): Promise<{ locks: Record<string, string>; changed: string[] }> {
  const locks: Record<string, string> = {}
  const changed: string[] = []
  for (const [id, entry] of Object.entries(registry.servers)) {
    const pkg = lspPackage(id, entry)
    if (pkg.source.type !== 'npm') continue
    const manifest = npmManifest({ ...pkg, source: pkg.source })
    const kept = current[id]
    if (kept !== undefined && lockMatches(kept, manifest)) locks[id] = kept
    else {
      locks[id] = await resolve(manifest)
      changed.push(id)
    }
  }
  return { locks, changed }
}

if (import.meta.main) {
  const file = path.join(import.meta.dir, '../src/features/lsp/language-servers.json')
  const { registry, changes } = await updateRegistry(await Bun.file(file).json())
  await Bun.write(file, `${JSON.stringify(registry, null, 2)}\n`)
  Bun.spawnSync([path.join(import.meta.dir, '../../../node_modules/.bin/oxfmt'), file])
  const { locks, changed: locked } = await relockRegistry(registry)
  const locksFile = path.join(import.meta.dir, '../src/features/lsp/language-server-locks.json')
  await Bun.write(locksFile, `${JSON.stringify(locks, null, 2)}\n`)
  console.log(changes.length ? changes.join('\n') : 'Every language server is up to date.')
  if (locked.length) console.log(`Locked the dependencies of: ${locked.join(', ')}`)
}

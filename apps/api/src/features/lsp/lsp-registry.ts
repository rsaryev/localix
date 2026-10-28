import registry from './language-servers.json'

/**
 * THE LANGUAGE SERVERS LOCALIX INSTALLS ON FIRST USE, as data (`language-servers.json`), in the
 * shape mason's registry made common: each server is one package URL plus the commands it
 * provides. Nothing ships with the app; a server is fetched the first time a file of its language
 * opens and nothing local serves it (`lsp-server-startup.ts`). Three kinds of source cover them:
 *
 * - `pkg:npm`: installed with the Bun that runs Localix, so no Node or npm is needed; install
 *   scripts never run and nothing published in the last week is taken (`lsp-installer.ts`).
 * - `pkg:github`: one release asset per platform, with its size and sha256.
 * - `pkg:golang`: built by the user's own Go toolchain, which checks the module against the Go
 *   checksum database. Without Go the server reports that it needs it.
 *
 * Versions are exact. `bun run --cwd apps/api lsp:update` moves them all to the newest release a
 * week old (`scripts/lsp-update.ts`); adding a server is one entry in the JSON.
 */

export type LspSource =
  | { type: 'npm'; name: string; version: string }
  | { type: 'github'; repo: string; version: string }
  | { type: 'golang'; module: string; version: string }

export type NpmSource = Extract<LspSource, { type: 'npm' }>

export interface LspAsset {
  /** The release asset's file name: `.gz` holds the executable, `.zip` an archive with it. */
  file: string
  bytes: number
  sha256: string
}

/** One server's entry as `language-servers.json` writes it. */
export interface LspRegistryEntry {
  source: string
  /** npm packages installed beside it at exact versions (a TypeScript for its tsserver). */
  with?: string[]
  /** For the updater: a package kept within a semver range. */
  hold?: Record<string, string>
  bin: string[]
  /** Keyed by `${process.platform}-${process.arch}`. */
  assets?: Record<string, LspAsset>
}

export interface LspPackage {
  id: string
  source: LspSource
  with: NpmSource[]
  bin: string[]
  assets: Partial<Record<string, LspAsset>>
}

/** A package URL (`pkg:<type>/<name>@<version>`) of a kind Localix installs. */
export function parseSource(purl: string): LspSource {
  const match = /^pkg:(npm|github|golang)\/(.+)@([^@/]+)$/.exec(purl)
  if (!match) throw new Error(`Not an installable package URL: ${purl}`)
  const [, type, name, version] = match as unknown as [string, LspSource['type'], string, string]
  const decoded = decodeURIComponent(name)
  if (type === 'npm') return { type, name: decoded, version }
  if (type === 'github') return { type, repo: decoded, version }
  return { type, module: decoded, version }
}

/** The package URL for a source, as the registry writes it. */
export function formatSource(source: LspSource): string {
  const name =
    source.type === 'npm'
      ? source.name.replace(/^@/, '%40')
      : source.type === 'github'
        ? source.repo
        : source.module
  return `pkg:${source.type}/${name}@${source.version}`
}

export function lspPackage(id: string, entry: LspRegistryEntry): LspPackage {
  const extra = (entry.with ?? []).map(parseSource)
  for (const source of extra)
    if (source.type !== 'npm') throw new Error(`${id}: only npm packages go beside a server`)
  return {
    id,
    source: parseSource(entry.source),
    with: extra as NpmSource[],
    bin: entry.bin,
    assets: entry.assets ?? {},
  }
}

export const LSP_PACKAGES: Readonly<Record<string, LspPackage>> = Object.fromEntries(
  Object.entries(registry.servers as Record<string, LspRegistryEntry>).map(([id, entry]) => [
    id,
    lspPackage(id, entry),
  ]),
)

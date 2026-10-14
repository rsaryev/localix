/**
 * The fork's decisions about its own package manifests, applied to every upstream manifest BEFORE
 * it enters the snapshot a merge is computed against.
 *
 * WHY BEFORE, NOT DURING. A decision recorded once (`workspace:*` between vendored packages, the
 * `private` guard, Localix's own scripts) sits on lines upstream edits every release — the version
 * line, the dependency ranges, the `build`/`test` scripts. Left to a line merge, that is a conflict
 * on every release over a question already answered: the 0.87 sync stopped on four manifests
 * because `type-check` sat next to an upstream `build` edit. Folding the decision into the upstream
 * side makes both merge inputs agree on those lines, so git never sees two edits there.
 *
 * Every rewrite is in place — one line's value, one inserted or removed line — so the rest of
 * upstream's bytes (key order, spacing, trailing newline) reach the merge untouched.
 */

type Scripts = Record<string, string>
interface Manifest {
  private?: boolean
  scripts?: Scripts
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies'] as const
const escapeRegex = (text: string) => text.replace(/[/@^$.*+?()[\]{}|\\]/g, '\\$&')

/**
 * The scripts Localix owns in a manifest: every key our copy sets differently from upstream's BASE
 * (added, changed or removed). Measured against the base, not the new head, so an upstream edit to
 * a key we never touched still flows in as an ordinary change.
 */
export function ownedScripts(ours: string, upstreamBase: string): string[] {
  const mine = (JSON.parse(ours) as Manifest).scripts ?? {}
  const base = (JSON.parse(upstreamBase) as Manifest).scripts ?? {}
  const keys = new Set([...Object.keys(mine), ...Object.keys(base)])
  return [...keys].filter((key) => mine[key] !== base[key]).sort()
}

/**
 * Owned scripts upstream ALSO changed between two of its versions, to something other than ours.
 * The policy keeps ours; this is what a person should read to decide whether ours should follow.
 */
export function ownedScriptDrift(
  ours: string,
  upstreamBase: string,
  upstreamHead: string,
): Array<{ key: string; base?: string; head?: string; ours?: string }> {
  const mine = (JSON.parse(ours) as Manifest).scripts ?? {}
  const base = (JSON.parse(upstreamBase) as Manifest).scripts ?? {}
  const head = (JSON.parse(upstreamHead) as Manifest).scripts ?? {}
  return ownedScripts(ours, upstreamBase)
    .filter((key) => base[key] !== head[key] && head[key] !== mine[key])
    .map((key) => ({ key, base: base[key], head: head[key], ours: mine[key] }))
}

/**
 * What Localix owns in one manifest, measured against upstream's BASE: the scripts we set
 * differently, and the dependencies we removed (upstream's `canvas` devDependency, which breaks
 * the desktop sidecar bundle). A removal is kept; a dependency we merely have is NOT owned, so
 * upstream's version bumps keep flowing in.
 */
export interface Ownership {
  scripts: string[]
  removedDependencies: Partial<Record<(typeof DEPENDENCY_FIELDS)[number], string[]>>
}

export function ownership(ours: string, upstreamBase: string): Ownership {
  const mine = JSON.parse(ours) as Manifest
  const base = JSON.parse(upstreamBase) as Manifest
  const removedDependencies: Ownership['removedDependencies'] = {}
  for (const field of DEPENDENCY_FIELDS) {
    const removed = Object.keys(base[field] ?? {}).filter(
      (name) => mine[field]?.[name] === undefined,
    )
    if (removed.length) removedDependencies[field] = removed.sort()
  }
  return { scripts: ownedScripts(ours, upstreamBase), removedDependencies }
}

/** Rewrite an upstream manifest to carry the fork's decisions. Returns it unchanged when none apply. */
export function applyManifestPolicy(
  upstream: string,
  ours: string,
  options: { ownership?: Ownership } = {},
): string {
  const mine = JSON.parse(ours) as Manifest
  const theirs = JSON.parse(upstream) as Manifest
  let patched = upstream

  // Workspace dependency values: a vendored package depends on its siblings as `workspace:*`, so a
  // version mismatch can never fall back to the public npm package.
  for (const field of DEPENDENCY_FIELDS) {
    for (const [name, range] of Object.entries(mine[field] ?? {})) {
      if (!range.startsWith('workspace:') || theirs[field]?.[name] === undefined) continue
      if (theirs[field]![name] === range) continue
      patched = patched.replace(
        new RegExp(`("${escapeRegex(name)}"\\s*:\\s*)"[^"]*"`),
        `$1"${range}"`,
      )
    }
  }

  // The `private` guard, placed right after `version`, where upstream edits every release.
  if (typeof mine.private === 'boolean' && theirs.private !== mine.private) {
    const privateLine = /^(\s*)"private"\s*:\s*(?:true|false),?$/m
    if (privateLine.test(patched)) {
      patched = patched.replace(privateLine, `$1"private": ${String(mine.private)},`)
    } else {
      const lines = patched.split('\n')
      const versionIndex = lines.findIndex((line) => /^\s*"version"\s*:/.test(line))
      if (versionIndex >= 0) {
        const indent = lines[versionIndex]!.match(/^\s*/)?.[0] ?? '\t'
        lines.splice(versionIndex + 1, 0, `${indent}"private": ${String(mine.private)},`)
        patched = lines.join('\n')
      }
    }
  }

  const ownership = options.ownership
  if (ownership?.scripts.length)
    patched = applyOwnedEntries(patched, ours, 'scripts', ownership.scripts)
  for (const field of DEPENDENCY_FIELDS) {
    const removed = ownership?.removedDependencies[field] ?? []
    if (removed.length) patched = applyOwnedEntries(patched, ours, field, removed)
  }
  return patched
}

/**
 * Put our lines for the owned keys into upstream's `field` block: same text as ours, at the
 * position ours has them (after the nearest preceding key the block shares), and our removals
 * removed. Commas are then recomputed for the block, the only lines whose punctuation depends on
 * their neighbours.
 */
function applyOwnedEntries(
  upstream: string,
  ours: string,
  field: string,
  owned: readonly string[],
): string {
  const theirsBlock = objectBlock(upstream, field)
  const oursBlock = objectBlock(ours, field) ?? { start: -1, end: -1, entries: [] }
  if (!theirsBlock) return upstream

  const ourEntries = oursBlock.entries
  const ourKeys = ourEntries.map((entry) => entry.key)
  const entries = theirsBlock.entries.filter(
    (entry) => !owned.includes(entry.key) || ourKeys.includes(entry.key),
  )

  for (const [index, ourEntry] of ourEntries.entries()) {
    if (!owned.includes(ourEntry.key)) continue
    const existing = entries.findIndex((entry) => entry.key === ourEntry.key)
    if (existing >= 0) {
      entries[existing] = ourEntry
      continue
    }
    const before = ourKeys
      .slice(0, index)
      .reverse()
      .find((key) => entries.some((entry) => entry.key === key))
    const at = before === undefined ? 0 : entries.findIndex((entry) => entry.key === before) + 1
    entries.splice(at, 0, ourEntry)
  }

  const body = entries.map(
    (entry, i) => `${entry.text.replace(/,$/, '')}${i < entries.length - 1 ? ',' : ''}`,
  )
  const lines = upstream.split('\n')
  lines.splice(theirsBlock.start + 1, theirsBlock.end - theirsBlock.start - 1, ...body)
  return lines.join('\n')
}

/** A top-level `"field": { … }` block as lines: one entry per line, the shape every pi manifest uses. */
function objectBlock(
  manifest: string,
  field: string,
): { start: number; end: number; entries: Array<{ key: string; text: string }> } | undefined {
  const lines = manifest.split('\n')
  const opening = new RegExp(`^\\s*"${escapeRegex(field)}"\\s*:\\s*\\{\\s*$`)
  const start = lines.findIndex((line) => opening.test(line))
  if (start < 0) return undefined
  const end = lines.findIndex((line, i) => i > start && /^\s*\},?\s*$/.test(line))
  if (end < 0) return undefined
  const entries = lines.slice(start + 1, end).map((text) => {
    const key = /^\s*"((?:[^"\\]|\\.)*)"\s*:/.exec(text)?.[1]
    return { key: key ?? '', text }
  })
  // A block this parser does not understand (multi-line values, comments) is left to the merge.
  if (entries.some((entry) => !entry.key)) return undefined
  return { start, end, entries }
}

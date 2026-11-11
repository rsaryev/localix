import { resolvePluginVersion, type VersionInput } from '@rsaryev/llx-plugin/marketplace'
import { nodeSha256 } from '../ports/marketplace-io'

/**
 * The version of an installed plugin, computed by the kit (`resolvePluginVersion`; plugins/
 * loading.md, "How Claude Code computes the version"): the manifest's `version`, else the entry's,
 * else what the source gives. The version names the cache folder and is how an update is detected:
 * an unchanged version installs nothing.
 */

/** What Localix knows about a plugin's source when its version is decided. */
export type VersionSourceFacts =
  | { kind: 'git'; commitSha?: string; subdir?: string; pinned?: boolean }
  | { kind: 'relative'; commitSha?: string }
  | { kind: 'archive'; sha256?: string }
  | { kind: 'npm' }
  | { kind: 'command' }

export { UNKNOWN_VERSION } from '@rsaryev/llx-plugin/marketplace'

const opt = <K extends string>(key: K, value: string | undefined) =>
  (value === undefined ? {} : { [key]: value }) as Partial<Record<K, string>>

/** A relative entry has a commit only inside a git-hosted marketplace. */
function sourceInput(source: VersionSourceFacts): VersionInput {
  const base = { inGitRepository: false, enclosingRepoIgnored: false }
  switch (source.kind) {
    case 'git':
      return source.subdir === undefined
        ? { ...base, sourceKind: 'github', ...opt('commitSha', source.commitSha) }
        : {
            ...base,
            sourceKind: 'git-subdir',
            subdir: source.subdir,
            ...opt('commitSha', source.commitSha),
          }
    case 'relative':
      return {
        ...base,
        sourceKind: 'relative',
        inGitRepository: source.commitSha !== undefined,
        ...opt('commitSha', source.commitSha),
      }
    case 'archive':
      return { ...base, sourceKind: 'archive', ...opt('archiveSha256', source.sha256) }
    case 'npm':
    case 'command':
      return { ...base, sourceKind: source.kind }
  }
}

export async function pluginVersion(input: {
  manifestVersion?: string | undefined
  entryVersion?: string | undefined
  source: VersionSourceFacts
}): Promise<string> {
  const facts: VersionInput = {
    ...sourceInput(input.source),
    ...opt('manifestVersion', input.manifestVersion),
    ...opt('entryVersion', input.entryVersion),
  }
  return (await resolvePluginVersion(facts, nodeSha256)).version
}

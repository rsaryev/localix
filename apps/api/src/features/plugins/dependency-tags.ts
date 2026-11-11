import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { childEnvNonInteractive } from '../../lib/login-shell-env'
import { cloneUrl, entryFetchPlan } from './kit'
import type { MarketplaceEntry, MarketplaceSource } from '@rsaryev/llx-plugin/marketplace'
import type { MarketplaceRegistryDeps } from './marketplace-registry'

const execFileAsync = promisify(execFile)

/**
 * The tags of the repository that hosts a plugin, for the kit's dependency plan to resolve a
 * version range against (`<plugin>--v<version>` release tags, dependencies.md, "Release a plugin
 * that others depend on"): which tag a range picks is the kit's (`installClosure`).
 */

/** The tag names of `url`, without fetching the repository. */
export async function lsRemoteTags(url: string): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['ls-remote', '--tags', '--refs', '--', url], {
    timeout: 60_000,
    env: childEnvNonInteractive(),
    windowsHide: true,
  })
  return stdout
    .split('\n')
    .map((line) => line.split('\t')[1]?.replace(/^refs\/tags\//, ''))
    .filter((tag): tag is string => !!tag)
}

/** The tags of the git repository an entry installs from; none for any other source. */
export async function entryTags(
  entry: MarketplaceEntry,
  hostedBy: MarketplaceSource,
  deps: Pick<MarketplaceRegistryDeps, 'listTags'>,
): Promise<string[]> {
  const plan = entryFetchPlan(entry, hostedBy)
  if (plan.kind !== 'git') return []
  return (deps.listTags ?? lsRemoteTags)(cloneUrl(plan.repo)).catch(() => [])
}

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { childEnvNonInteractive } from '../../lib/login-shell-env'
import type { MarketplaceRegistryDeps } from './marketplace-registry'

const execFileAsync = promisify(execFile)

/**
 * Release tags for dependency version ranges (dependencies.md, "Release a plugin that others
 * depend on"): a plugin's releases are tagged `<plugin-name>--v<version>` on the repository that
 * hosts it, and a range installs the highest tag it admits. A pre-release matches only a range
 * that opts in (`^2.0.0-0`), as semver ranges do.
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

/** The highest `<plugin>--v<version>` tag of `url` that `range` admits, or undefined. */
export async function tagInRange(
  plugin: string,
  url: string,
  range: string,
  deps: Pick<MarketplaceRegistryDeps, 'listTags'>,
): Promise<{ tag: string; version: string } | undefined> {
  const prefix = `${plugin}--v`
  const candidates = (await (deps.listTags ?? lsRemoteTags)(url))
    .filter((tag) => tag.startsWith(prefix))
    .map((tag) => ({ tag, version: tag.slice(prefix.length) }))
    .filter(({ version }) => {
      try {
        return Bun.semver.satisfies(version, range)
      } catch {
        return false
      }
    })
    .sort((a, b) => Bun.semver.order(a.version, b.version))
  return candidates.at(-1)
}

import { describe, expect, it } from 'bun:test'

import type { DiscoveredPlugin } from './discovery'
import { withDependencyVersionChecks } from './dependency-versions'

/**
 * A plugin whose dependency is installed outside the version range it declares stays off
 * (dependencies.md, "How a constraint resolves against tags": `Requires "x@m" ~2.1.0, installed
 * 3.0.0`); a dependency in range, or one without a version, leaves it loading.
 */

const plugin = (name: string, version: string | undefined, dependencies?: unknown[]) =>
  ({
    manifest: { name, version: version ?? '0.0.0', dependencies },
    rawManifest: version ? { name, version } : { name },
  }) as unknown as DiscoveredPlugin

describe('dependency versions at load', () => {
  it('blocks a plugin whose dependency is out of range, naming both', () => {
    const [app] = withDependencyVersionChecks([
      plugin('app', '1.0.0', [{ name: 'vault', version: '~2.1.0' }]),
      plugin('vault', '3.0.0'),
    ])
    expect(app!.error).toBe('Requires "vault" ~2.1.0, installed 3.0.0')
  })

  it('leaves a plugin whose dependency is in range, or states no version', () => {
    const plugins = withDependencyVersionChecks([
      plugin('app', '1.0.0', [{ name: 'vault', version: '^2.0.0' }, 'other']),
      plugin('vault', '2.4.0'),
      plugin('other', undefined),
    ])
    expect(plugins.map((found) => found.error)).toEqual([undefined, undefined, undefined])
  })

  it('blocks a range against a dependency that states no version', () => {
    const [app] = withDependencyVersionChecks([
      plugin('app', '1.0.0', [{ name: 'vault', version: '^2.0.0' }]),
      plugin('vault', undefined),
    ])
    expect(app!.error).toBe('Requires "vault" ^2.0.0, installed with no version')
  })
})

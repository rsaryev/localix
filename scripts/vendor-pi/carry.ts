/**
 * CARRY: bring a package newly listed in `PACKAGES` into `vendor/pi` at the upstream commit the
 * fork already holds — not at upstream's head, which is what `sync` is for.
 *
 * A sync moves every vendored package to a new upstream at once; adding one package must not. The
 * files come out of the same deterministic snapshot a sync would merge (`buildSnapshot` at the
 * recorded base), so the tree a later sync or registration computes against is exactly the tree
 * carried here, and the new manifest takes the fork's standing decisions once (`adoptManifest`),
 * after which the manifest policy treats them as ours like every other package's.
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { INSTALL_TIMEOUT_MS, PACKAGES, VENDOR_DIR } from './config'
import { adoptManifest } from './manifest-policy'
import { run, SyncFailure } from './run'
import { buildSnapshot } from './snapshot'
import type { SyncContext } from './sync'
import { recordedUpstream } from './upstream-doc'

/** Listed packages the snapshot holds and `vendor/pi` does not. */
export async function uncarriedPackages(root: string, snapshot: string): Promise<string[]> {
  const missing: string[] = []
  for (const pkg of PACKAGES) {
    if (existsSync(join(root, VENDOR_DIR, pkg, 'package.json'))) continue
    const held = await run(
      ['git', 'cat-file', '-e', `${snapshot}:${VENDOR_DIR}/${pkg}/package.json`],
      {
        cwd: root,
      },
    )
    if (held.ok) missing.push(pkg)
  }
  return missing
}

export async function carry(ctx: SyncContext): Promise<'carried' | 'up-to-date'> {
  const status = await run(['git', 'status', '--porcelain', '--', VENDOR_DIR], { cwd: ctx.root })
  if (status.stdout) {
    throw new SyncFailure(
      'carrying a package needs a clean vendor/pi',
      'Commit or stash your work there, then run it again.',
    )
  }

  const upstream = await recordedUpstream(ctx.root)
  const snapshot = await buildSnapshot({ root: ctx.root, url: ctx.url, upstream })
  const missing = await uncarriedPackages(ctx.root, snapshot.commit)
  if (missing.length === 0) {
    ctx.log(
      `vendor/pi already carries every listed package upstream ${upstream.slice(0, 12)} holds`,
    )
    return 'up-to-date'
  }
  const checkout = await run(
    ['git', 'checkout', snapshot.commit, '--', ...missing.map((pkg) => `${VENDOR_DIR}/${pkg}`)],
    { cwd: ctx.root },
  )
  if (!checkout.ok)
    throw new SyncFailure(
      'checking out the carried packages failed',
      checkout.stderr || checkout.stdout,
    )
  for (const pkg of missing) {
    const manifest = join(ctx.root, VENDOR_DIR, pkg, 'package.json')
    await writeFile(manifest, adoptManifest(await readFile(manifest, 'utf8')))
  }

  if (ctx.install) {
    ctx.log('a vendored package arrived — bun install …')
    const install = await run(['bun', 'install'], { cwd: ctx.root, timeoutMs: INSTALL_TIMEOUT_MS })
    if (!install.ok)
      throw new SyncFailure('bun install failed after carrying', install.stderr || install.stdout)
  }
  ctx.log(
    `carried ${missing.join(', ')} at upstream ${upstream.slice(0, 12)}; ` +
      'record it in vendor/pi/UPSTREAM.md ("Vendored packages") and commit',
  )
  return 'carried'
}

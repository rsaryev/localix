import { promises as fs } from 'node:fs'
import { isAbsolute, join } from 'node:path'

import { isPathWithin } from '../../lib/path-containment'
import { ConflictError, UnprocessableError } from '../../lib/domain-errors'
import { loadMiniApp } from './folder'
import { installCopy } from './managed-copy'
import { INSTALL_RECORD_FILE, installedBy } from './store-install'
import { validateMiniApp } from './validate'

/**
 * Installing a mini app the person built (`mini-app install`, from the authoring plugin).
 * Localix does not build mini apps; it takes a built PACKAGE — the folder `mini-app build` writes —
 * judges it the way discovery will, and installs a copy beside the marketplaces' apps with the same
 * atomic swap. The copy is the person's own: no marketplace updates or removes it, and installing it
 * means wanting it to run, so it is switched on.
 *
 * The source stays where the person keeps it; only the record names it.
 */

export const LOCAL_INSTALL_KIND = 'localix-local-install'

export interface LocalInstallRecord {
  kind: typeof LOCAL_INSTALL_KIND
  source: string
  version: string
  installedAt: string
}

export interface LocalInstallDeps {
  /** `~/.localix/mini-apps`. */
  installRoot: string
  enable(name: string): Promise<unknown>
  /** Every host re-reads its mini apps (the change notice). */
  changed(): Promise<unknown>
  now?: () => string
}

const BUILT_MODULE = /\.(?:mjs|js)$/u

export async function installedLocally(dir: string): Promise<boolean> {
  try {
    const record = JSON.parse(await fs.readFile(join(dir, INSTALL_RECORD_FILE), 'utf8'))
    return record?.kind === LOCAL_INSTALL_KIND
  } catch {
    return false
  }
}

export async function installLocalPackage(
  input: { dir: string; source: string },
  deps: LocalInstallDeps,
): Promise<{ name: string; version: string; warnings: string[] }> {
  if (!isAbsolute(input.dir) || !(await fs.stat(input.dir).catch(() => null))?.isDirectory()) {
    throw new UnprocessableError('mini_app_package_missing', `No package folder at ${input.dir}`)
  }
  const app = await loadMiniApp(input.dir, 'global', '')
  const { errors, warnings } = validateMiniApp(app)
  const source = app.backendEntries.find((entry) => !BUILT_MODULE.test(entry))
  if (source) {
    errors.push(
      `The backend ${source} is source: install the package \`mini-app build\` writes, not the source folder`,
    )
  }
  if (errors.length || !app.manifest) {
    throw new UnprocessableError('mini_app_package_invalid', errors.join('\n'))
  }
  const { name, version } = app.manifest
  const target = join(deps.installRoot, name)

  if (isPathWithin(target, input.dir) || isPathWithin(target, input.source)) {
    throw new ConflictError(
      'mini_app_source_inside_install',
      `"${name}" is being built inside ${target}, where Localix installs it; move the folder elsewhere and install from there`,
    )
  }
  const by = await installedBy(target)
  if (by === 'marketplace' || by === 'staged') {
    throw new ConflictError(
      'mini_app_name_taken',
      `"${name}" is installed from ${by === 'marketplace' ? 'a marketplace' : 'Localix'}; remove it first, or give yours another name`,
    )
  }
  if (by === 'person' && !(await installedLocally(target))) {
    throw new ConflictError(
      'mini_app_name_taken',
      `A mini app of yours is already at ${target}; move it out or give this one another name`,
    )
  }

  await installCopy(input.dir, target, {
    file: INSTALL_RECORD_FILE,
    contents: {
      kind: LOCAL_INSTALL_KIND,
      source: input.source,
      version,
      installedAt: (deps.now ?? (() => new Date().toISOString()))(),
    } satisfies LocalInstallRecord,
  })
  await deps.changed()
  await deps.enable(name)
  return { name, version, warnings }
}

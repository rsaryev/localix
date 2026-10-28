import { randomUUID } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MANIFEST_FILE } from '../check/check'
import { mediaFields } from '../check/media'
import type { Kit } from '../kit/kit'
import { readAppFile } from '../lib/app-file'
import { UserError } from '../lib/errors'
import { isPathBelow, resolveWithin } from '../lib/paths'

/**
 * What Localix will say about a PACKAGE before it installs it: a built folder, or a catalog archive
 * of one. The manifest by the SDK's schema, a backend that is a built module inside the package,
 * every file the manifest names present, and the store media — a media problem is a warning, since
 * the app runs without an icon, but a catalog refuses it.
 */

export interface PackageVerdict {
  ok: boolean
  name: string | null
  problems: string[]
  warnings: string[]
}

const BUILT_MODULE = /\.(?:mjs|js)$/u

function namedFiles(manifest: Record<string, unknown>): string[] {
  const found: string[] = []
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      if (value.startsWith('./')) found.push(value)
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item)
    } else if (value && typeof value === 'object') {
      for (const child of Object.values(value)) visit(child)
    }
  }
  visit(manifest)
  return found
}

/**
 * `archived`: the folder is an unpacked catalog archive. A catalog publishes the screenshots beside
 * the archive, not inside it, so they are neither required on disk nor read for the media rules.
 */
export async function validatePackageDir(
  kit: Kit,
  dir: string,
  options: { archived?: boolean } = {},
): Promise<PackageVerdict> {
  const problems: string[] = []
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(await fs.readFile(join(dir, MANIFEST_FILE), 'utf8')) as Record<
      string,
      unknown
    >
  } catch (error) {
    return {
      ok: false,
      name: null,
      problems: [`${MANIFEST_FILE}: ${(error as Error).message}`],
      warnings: [],
    }
  }
  const verdict = await kit.tools.manifest.validate(dir)
  problems.push(...verdict.errors)

  const backend = manifest.backend
  if (typeof backend === 'string' && !BUILT_MODULE.test(backend)) {
    problems.push(
      `backend ${backend} is a source file: a package carries the built bundle (run \`mini-app build\` on the source folder)`,
    )
  }
  const fields = mediaFields(manifest)
  const published = new Set(options.archived ? fields.screenshots?.map((shot) => shot.path) : [])
  for (const path of namedFiles(manifest)) {
    if (published.has(path)) continue
    const target = resolveWithin(dir, path)
    if (!target) problems.push(`${path} points outside the package`)
    else if (!existsSync(target)) problems.push(`${path} is named in ${MANIFEST_FILE} but missing`)
  }

  const media = await kit.tools.manifest.checkMedia(
    options.archived ? { ...fields, screenshots: [] } : fields,
    (path) => readAppFile(dir, path),
    { requireIcon: true },
  )
  const warnings = [...verdict.warnings, ...media]
  return {
    ok: problems.length === 0,
    name: typeof manifest.name === 'string' ? manifest.name : null,
    problems,
    warnings,
  }
}

/** A folder, or a `.tar.gz` catalog archive unpacked to a temporary folder first. */
export async function validatePackage(kit: Kit, path: string): Promise<PackageVerdict> {
  if (!path.endsWith('.tar.gz') && !path.endsWith('.tgz')) return validatePackageDir(kit, path)
  if (!existsSync(path)) throw new UserError(`${path} does not exist`)
  const work = join(tmpdir(), `mini-app-validate-${randomUUID()}`)
  try {
    const archive = new Bun.Archive(new Uint8Array(await fs.readFile(path)))
    for (const [entry, file] of await archive.files()) {
      const target = join(work, entry)
      if (!isPathBelow(work, target)) {
        return {
          ok: false,
          name: null,
          problems: [`the archive names ${entry}, outside itself`],
          warnings: [],
        }
      }
      await Bun.write(target, file)
    }
    return await validatePackageDir(kit, work, { archived: true })
  } finally {
    await fs.rm(work, { recursive: true, force: true })
  }
}

export function formatVerdict(path: string, verdict: PackageVerdict): string {
  const lines = [
    verdict.ok
      ? `${verdict.name ?? path}: a valid package.`
      : `${verdict.name ?? path}: ${verdict.problems.length} problem(s).`,
  ]
  for (const problem of verdict.problems) lines.push(`- ${problem}`)
  for (const warning of verdict.warnings) lines.push(`- warning: ${warning}`)
  return lines.join('\n')
}

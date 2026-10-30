import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { MINI_APP_MANIFEST_FILE } from '@localixai/mini-app-sdk/app-manifest'

/**
 * A mini app as a marketplace ships it: one gzip tarball whose root is the app's folder — its
 * manifest at `.localix-mini-app/mini-app.json`, the built backend and screens beside the folder.
 * A marketplace release packs them; the store unpacks one only after its sha256 matched.
 */

export interface UnpackLimits {
  /** The unpacked bytes, all files together. */
  maxBytes?: number
  maxFiles?: number
}

const DEFAULT_LIMITS = { maxBytes: 512 * 1024 * 1024, maxFiles: 20_000 }

/** Pack a folder's files (path → contents), the format {@link unpackMiniAppArchive} reads. */
export async function packMiniAppFiles(
  files: Record<string, string | Uint8Array | Blob>,
): Promise<Uint8Array> {
  return new Bun.Archive(files, { compress: 'gzip' }).bytes()
}

/**
 * A path that stays inside the folder: relative, forward slashes, no `.` or `..` segment. A
 * tarball can name any path; one that climbs out is a hostile archive, not a mistake.
 */
function safeRelative(path: string): string | null {
  if (!path || path.includes('\0') || path.includes('\\') || path.startsWith('/')) return null
  const segments = path.replace(/\/+$/, '').split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null
  return segments.join('/')
}

/**
 * Unpack an archive into `dest` (created; it must not hold an app yet), refusing it whole when a
 * path escapes, it is larger than the limits, or its manifest is not the app and version the
 * marketplace promised — so a half-checked archive never reaches the install root.
 */
export async function unpackMiniAppArchive(
  bytes: Uint8Array,
  dest: string,
  expected: { name: string; version: string },
  limits: UnpackLimits = {},
): Promise<void> {
  const { maxBytes, maxFiles } = { ...DEFAULT_LIMITS, ...limits }
  const files = await new Bun.Archive(bytes).files()
  if (files.size > maxFiles)
    throw new Error(`The archive holds ${files.size} files, more than the ${maxFiles} allowed`)
  const planned: [string, Blob][] = []
  let total = 0
  for (const [path, file] of files) {
    const relative = safeRelative(path)
    if (!relative) throw new Error(`The archive names a path outside the mini app: ${path}`)
    total += file.size
    if (total > maxBytes)
      throw new Error(`The archive is larger than the ${maxBytes} bytes a mini app may unpack to`)
    planned.push([relative, file])
  }

  const manifestFile = planned.find(([path]) => path === MINI_APP_MANIFEST_FILE)?.[1]
  if (!manifestFile) throw new Error(`The archive has no ${MINI_APP_MANIFEST_FILE} at its root`)
  let manifest: { name?: unknown; version?: unknown }
  try {
    manifest = JSON.parse(await manifestFile.text())
  } catch {
    throw new Error(`The archive's ${MINI_APP_MANIFEST_FILE} does not parse`)
  }
  if (manifest.name !== expected.name)
    throw new Error(
      `The archive holds the mini app "${String(manifest.name)}", not "${expected.name}"`,
    )
  if (manifest.version !== expected.version)
    throw new Error(
      `The archive holds version ${String(manifest.version)} of "${expected.name}", not ${expected.version}`,
    )

  await fs.mkdir(dest, { recursive: true })
  for (const [path, file] of planned) {
    const target = join(dest, path)
    await fs.mkdir(dirname(target), { recursive: true })
    await Bun.write(target, file)
  }
}

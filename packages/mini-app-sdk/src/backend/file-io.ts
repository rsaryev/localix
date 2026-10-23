import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export async function statIfExists(path: string) {
  try {
    return await stat(path)
  } catch {
    return null
  }
}

export async function ensureParentDir(path: string, opts?: { mode?: number }): Promise<void> {
  await mkdir(dirname(path), { recursive: true, ...(opts?.mode ? { mode: opts.mode } : {}) })
}

/**
 * Atomic write: write to a temp file in the same directory, then rename over the
 * target. A crash or concurrent reader never observes a half-written file.
 *
 * Accepts text OR raw bytes (a binary deliverable — `.docx`/`.xlsx`/`.pdf`): a
 * half-written binary is corrupt and unopenable, so it needs the same temp+rename
 * guarantee as a text file. `node:fs` ignores the `'utf8'` encoding for a Uint8Array.
 *
 * `mode` matters more here than for a plain write, which is why it is a parameter and
 * not the caller's job afterwards: the temp is a NEW file, so it is born at the default
 * 0644 and the rename carries that onto the target. A caller chmod-ing after the fact
 * would leave a window where the finished file is readable by everyone — and for a
 * secrets file that window is the whole point of the 0600. Setting it on the temp means
 * the target never exists with the wrong permissions at all.
 */
export async function atomicWriteFile(
  path: string,
  content: string | Uint8Array,
  opts?: { mode?: number },
): Promise<void> {
  // A private FILE inside a world-readable directory is still a leak of its name and size, and the
  // dir is created here — so a caller asking for 0600 gets 0700 around it without a second option
  // to forget. `mkdir` only applies the mode to directories it CREATES; an existing one is left
  // alone, which is correct (we must not tighten a directory the user shares deliberately).
  await ensureParentDir(path, opts?.mode ? { mode: 0o700 } : undefined)
  const tmp = join(
    dirname(path),
    `.${basename(path)}.${process.pid.toString(36)}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.tmp`,
  )
  try {
    await writeFile(tmp, content, { encoding: 'utf8', ...(opts?.mode ? { mode: opts.mode } : {}) })
    await rename(tmp, path)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  }
}

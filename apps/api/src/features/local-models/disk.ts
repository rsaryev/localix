/**
 * Free disk space where models are stored, checked before a download starts: a download that
 * cannot finish should say so up front, not fail at 90%. A reserve stays free for the system.
 */
import { mkdir, statfs } from 'node:fs/promises'

/** Kept free beside a download (Magnitude plans with the same). */
export const DISK_RESERVE_BYTES = 2 * 2 ** 30

/** Bytes free on the volume holding `dir`, or null when the platform cannot tell. */
export async function freeBytes(dir: string): Promise<number | null> {
  try {
    await mkdir(dir, { recursive: true })
    const stats = await statfs(dir)
    return stats.bavail * stats.bsize
  } catch {
    return null
  }
}

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`

/** Throws a sentence a person can act on when `needed` bytes (plus the reserve) are not free. */
export async function ensureDiskSpace(dir: string, needed: number): Promise<void> {
  const free = await freeBytes(dir)
  if (free === null || free >= needed + DISK_RESERVE_BYTES) return
  throw new Error(
    `Not enough disk space: the download needs ${gb(needed + DISK_RESERVE_BYTES)} free and ${gb(free)} is free.`,
  )
}

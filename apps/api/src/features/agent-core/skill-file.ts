import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs'
import { lstat, open } from 'node:fs/promises'

/** Matches the remote-skill resource ceiling: large prompts are rejected, never truncated. */
export const MAX_SKILL_MARKDOWN_BYTES = 1024 * 1024

export type SkillFileReadErrorCode =
  | 'too_large'
  | 'not_regular_file'
  | 'changed_during_read'
  | 'invalid_utf8'

export class SkillFileReadError extends Error {
  readonly code: SkillFileReadErrorCode
  readonly path: string

  constructor(code: SkillFileReadErrorCode, path: string, message: string) {
    super(message)
    this.name = 'SkillFileReadError'
    this.code = code
    this.path = path
  }
}

export function assertSkillMarkdownSize(raw: string, path: string): void {
  const size = Buffer.byteLength(raw, 'utf8')
  if (size > MAX_SKILL_MARKDOWN_BYTES) {
    throw new SkillFileReadError(
      'too_large',
      path,
      `file is ${size} bytes; limit is ${MAX_SKILL_MARKDOWN_BYTES} bytes`,
    )
  }
}

function skillReadFlags(): number {
  // Discovery canonicalizes symlinks before reaching this reader. Refuse a raced
  // replacement symlink here so a path cannot be redirected between realpath and open.
  const noFollow =
    process.platform !== 'win32' && typeof constants.O_NOFOLLOW === 'number'
      ? constants.O_NOFOLLOW
      : 0
  return constants.O_RDONLY | constants.O_NONBLOCK | noFollow
}

function decodeSkillMarkdown(bytes: Uint8Array, path: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new SkillFileReadError('invalid_utf8', path, 'file is not valid UTF-8')
  }
}

/**
 * Read one UTF-8 skill/command file without ever allocating or reading beyond the
 * configured ceiling. The open handle pins the file identity; a final one-byte probe
 * catches growth after stat instead of silently parsing a truncated prompt.
 */
export async function readSkillMarkdownFile(path: string): Promise<string> {
  // O_NONBLOCK prevents a raced regular-file candidate from hanging discovery if
  // an attacker swaps it for a FIFO between canonicalization and open.
  const handle = await open(path, skillReadFlags())
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) {
      throw new SkillFileReadError('not_regular_file', path, 'path is not a regular file')
    }
    const pathStat = await lstat(path)
    if (!pathStat.isFile() || pathStat.dev !== stat.dev || pathStat.ino !== stat.ino) {
      throw new SkillFileReadError(
        'changed_during_read',
        path,
        'file identity changed while it was being opened',
      )
    }
    if (stat.size > MAX_SKILL_MARKDOWN_BYTES) {
      throw new SkillFileReadError(
        'too_large',
        path,
        `file is ${stat.size} bytes; limit is ${MAX_SKILL_MARKDOWN_BYTES} bytes`,
      )
    }

    const bytes = Buffer.allocUnsafe(stat.size)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    const extra = Buffer.allocUnsafe(1)
    if ((await handle.read(extra, 0, 1, offset)).bytesRead !== 0) {
      throw new SkillFileReadError(
        'changed_during_read',
        path,
        'file changed while it was being read',
      )
    }

    return decodeSkillMarkdown(bytes.subarray(0, offset), path)
  } finally {
    await handle.close()
  }
}

/**
 * Synchronous twin used only by the lazy `DiscoveredSkill.content` accessor.
 * Discovery itself remains async/concurrency-bounded; an explicit skill invocation
 * reads at most one body synchronously, preserving the existing string property API.
 */
export function readSkillMarkdownFileSync(path: string): string {
  const fd = openSync(path, skillReadFlags())
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) {
      throw new SkillFileReadError('not_regular_file', path, 'path is not a regular file')
    }
    const pathStat = lstatSync(path)
    if (!pathStat.isFile() || pathStat.dev !== stat.dev || pathStat.ino !== stat.ino) {
      throw new SkillFileReadError(
        'changed_during_read',
        path,
        'file identity changed while it was being opened',
      )
    }
    if (stat.size > MAX_SKILL_MARKDOWN_BYTES) {
      throw new SkillFileReadError(
        'too_large',
        path,
        `file is ${stat.size} bytes; limit is ${MAX_SKILL_MARKDOWN_BYTES} bytes`,
      )
    }

    const bytes = Buffer.allocUnsafe(stat.size)
    let offset = 0
    while (offset < bytes.length) {
      const bytesRead = readSync(fd, bytes, offset, bytes.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    const extra = Buffer.allocUnsafe(1)
    if (readSync(fd, extra, 0, 1, offset) !== 0) {
      throw new SkillFileReadError(
        'changed_during_read',
        path,
        'file changed while it was being read',
      )
    }

    return decodeSkillMarkdown(bytes.subarray(0, offset), path)
  } finally {
    closeSync(fd)
  }
}

export function skillFileErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

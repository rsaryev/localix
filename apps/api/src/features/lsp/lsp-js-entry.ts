import fs from 'node:fs'
import path from 'node:path'

/**
 * The JavaScript file behind a `node_modules/.bin` entry — what `spawnJsServer` hands to the
 * runtime executing the API, so a JS language server needs no separate Node install.
 */

/** The first `bytes` of a file — shims are tiny, and a PE `.exe` must not be read whole. */
function readHead(file: string, bytes: number): Buffer | undefined {
  let fd: number | undefined
  try {
    fd = fs.openSync(file, 'r')
    const buffer = Buffer.alloc(bytes)
    return buffer.subarray(0, fs.readSync(fd, buffer, 0, bytes, 0))
  } catch {
    return undefined
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

/** `.js`/`.cjs`/`.mjs`, or an extensionless script whose shebang names a JS runtime. */
function isJsEntry(file: string): boolean {
  if (/\.[cm]?js$/i.test(file)) return isFile(file)
  const head = readHead(file, 128)?.toString('utf8') ?? ''
  return /^#!.*\b(?:node|bun)\b/.test(head)
}

/** Shim suffixes package managers write beside (or instead of) the `.bin` symlink. */
const SHIM_SUFFIX = /\.(?:cmd|bat|ps1|exe|bunx)$/i

/**
 * Every path a shim names relative to its own directory: `%dp0%\…` / `%~dp0\…` in a
 * `.cmd`, `$basedir/…` in the sh and `.ps1` shims, and the UTF-16 path at the head of
 * Bun's `.bunx`. Candidates, not answers — the same shims also name `node.exe`.
 */
function shimTargets(shim: string): string[] {
  const bytes = readHead(shim, 8 * 1024)
  if (!bytes?.length) return []
  const dir = path.dirname(shim)
  if (shim.toLowerCase().endsWith('.bunx')) {
    const target = bytes.toString('utf16le').split('"')[0]!
    return target ? [path.resolve(dir, target.replaceAll('\\', '/'))] : []
  }
  const text = bytes.toString('utf8')
  return [...text.matchAll(/(?:%~?dp0%?|\$basedir)[\\/]+([^"'*\r\n]+?)["']/g)].map((m) =>
    path.resolve(dir, m[1]!.replaceAll('\\', '/')),
  )
}

/**
 * The JavaScript file a `node_modules/.bin` entry stands for, or undefined.
 *
 * On POSIX the `.bin` entry is a symlink to the package's JS and `realpath` is the whole
 * answer. On Windows it is NOT: npm/pnpm write `.cmd`/`.ps1`/sh shims and Bun writes an
 * `.exe` plus a `.bunx` descriptor, and handing any of those to `bun` as a script made it
 * parse a batch file or a PE binary as JavaScript — every JS language server (TypeScript,
 * JSON, CSS, YAML, …) crashed on start. So a shim is read for the path it launches, and
 * only a candidate that exists AND is JS is accepted (the same shims also name `node.exe`).
 */
export function resolveJsEntry(binPath: string): string | undefined {
  let real = binPath
  try {
    real = fs.realpathSync(binPath)
  } catch {
    /* judge the bin path as-is */
  }
  if (isJsEntry(real)) return real
  const base = binPath.replace(SHIM_SUFFIX, '')
  for (const shim of [base, `${base}.cmd`, `${base}.ps1`, `${base}.bunx`]) {
    const target = shimTargets(shim).find(
      (candidate) => !/[\\/]node(?:\.exe)?$/i.test(candidate) && isJsEntry(candidate),
    )
    if (target) return target
  }
  return undefined
}

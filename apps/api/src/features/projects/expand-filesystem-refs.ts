/** Read-only file and folder expansion with the existing confinement and content limits. */
import path from 'node:path'
import { readFile, readdir, stat } from 'node:fs/promises'
import { hasBinarySignature } from '@localixai/mini-app-sdk/backend'
import { resolveWithin } from '../../lib/path-containment'
import type { ContextRef, ContextRefExpansion } from './contracts'
import { fail, succeed } from './ref-expansion-result'

/** Max lines returned for a single @file ref. */
const MAX_FILE_LINES = 4000
/** Max bytes read from a single file before refusing. */
const MAX_FILE_BYTES = 1_500_000
/** Max entries in a @folder listing. */
const MAX_FOLDER_ENTRIES = 200

/** File basenames that are always blocked (credential files). */
const SENSITIVE_BASENAMES = [
  /^\.env(\..+)?$/i,
  /^id_rsa/i,
  /^id_ed25519/i,
  /^id_ecdsa/i,
  /^id_dsa/i,
  /^\.netrc$/i,
  /^\.npmrc$/i,
  /^\.pgpass$/i,
  /^\.pypirc$/i,
  /\.pem$/i,
  /\.key$/i,
]

/** Directory segments that block any file inside them. */
const SENSITIVE_DIR_SEGMENTS = new Set(['.ssh', '.aws', '.kube', '.gnupg'])

const EXT_LANGUAGE: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  mjs: 'js',
  cjs: 'js',
  json: 'json',
  md: 'md',
  css: 'css',
  scss: 'scss',
  html: 'html',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  sql: 'sql',
  xml: 'xml',
  php: 'php',
  graphql: 'graphql',
}

function languageForPath(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  return EXT_LANGUAGE[ext] ?? ''
}

export function isSensitivePath(absPath: string): boolean {
  const base = path.basename(absPath)
  if (SENSITIVE_BASENAMES.some((re) => re.test(base))) return true
  return absPath.split(path.sep).some((seg) => SENSITIVE_DIR_SEGMENTS.has(seg))
}

/** Resolves `p` inside `workingDir`; returns null when it escapes the root. */
const confine = resolveWithin

/**
 * The checks a `@file:` ref passes before it is read or sized: it names a path, inside the
 * working directory, that is not a credential file and is an existing file, not a folder.
 */
export async function statFileRef(
  workingDir: string,
  ref: ContextRef,
): Promise<{ resolved: string; size: number } | { refused: ContextRefExpansion }> {
  if (!ref.path) return { refused: fail(ref, 'missing path') }
  const resolved = confine(workingDir, ref.path)
  if (!resolved) return { refused: fail(ref, 'path is outside the project working directory') }
  if (isSensitivePath(resolved))
    return { refused: fail(ref, 'path looks like a sensitive credential file') }
  let info
  try {
    info = await stat(resolved)
  } catch {
    return { refused: fail(ref, 'file not found') }
  }
  if (info.isDirectory()) return { refused: fail(ref, 'path is a directory — use @folder:') }
  return { resolved, size: info.size }
}

export async function expandFile(
  workingDir: string,
  ref: ContextRef,
): Promise<ContextRefExpansion> {
  const file = await statFileRef(workingDir, ref)
  if ('refused' in file) return file.refused
  const { resolved } = file
  if (file.size > MAX_FILE_BYTES)
    return fail(ref, `file too large (${Math.round(file.size / 1024)}KB)`)

  const buffer = await readFile(resolved)
  if (hasBinarySignature(buffer)) return fail(ref, 'binary files are not supported')

  let lines = buffer.toString('utf8').split('\n')
  let rangeNote = ''
  if (ref.startLine) {
    const start = ref.startLine
    const end = ref.endLine ?? ref.startLine
    if (end >= start && start <= lines.length) {
      lines = lines.slice(start - 1, end)
    } else {
      // Invalid range falls through to the full file — but SAY so, or the model
      // silently gets 4000 lines when the user asked for one.
      const asked = end === start ? `line ${start}` : `lines ${start}-${end}`
      rangeNote = `[requested ${asked} is out of range — file has ${lines.length} lines; showing the full file]\n`
    }
  }
  const truncated = lines.length > MAX_FILE_LINES
  if (truncated) lines = lines.slice(0, MAX_FILE_LINES)
  let content = rangeNote + lines.join('\n')
  if (truncated) content += `\n[…truncated at ${MAX_FILE_LINES} lines…]`
  return succeed(ref, content, { language: languageForPath(resolved), truncated })
}

export async function expandFolder(
  workingDir: string,
  ref: ContextRef,
): Promise<ContextRefExpansion> {
  const target = ref.path ?? '.'
  const resolved = confine(workingDir, target)
  if (!resolved) return fail(ref, 'path is outside the project working directory')
  if (isSensitivePath(resolved)) return fail(ref, 'path looks like a sensitive directory')

  let entries
  try {
    entries = await readdir(resolved, { withFileTypes: true })
  } catch {
    return fail(ref, 'folder not found')
  }
  const names = entries
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    .sort((a, b) => {
      const aDir = a.endsWith('/')
      const bDir = b.endsWith('/')
      return aDir !== bDir ? (aDir ? -1 : 1) : a.localeCompare(b)
    })
  const truncated = names.length > MAX_FOLDER_ENTRIES
  const shown = truncated ? [...names.slice(0, MAX_FOLDER_ENTRIES), '…'] : names
  return succeed(ref, shown.map((n) => `- ${n}`).join('\n'), { truncated })
}

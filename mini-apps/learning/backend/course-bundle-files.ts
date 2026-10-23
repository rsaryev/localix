import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import type { z } from 'zod'
import { isPathWithin } from '@localixai/path-containment'
import { validationError } from './course-bundle-errors'

const MAX_JSON_BYTES = 256_000
export const MAX_MARKDOWN_BYTES = 512_000

export function contained(root: string, target: string): boolean {
  return isPathWithin(root, target)
}

export async function readCapped(path: string, maxBytes: number): Promise<string> {
  let metadata: Awaited<ReturnType<typeof stat>>
  try {
    metadata = await stat(path)
  } catch (cause) {
    throw validationError(
      {
        code: 'missing-reference',
        file: path,
        message: 'The referenced bundle file does not exist or cannot be read.',
        fix: 'Create the file at this exact path or correct the relative reference in its owner manifest.',
      },
      cause,
    )
  }
  if (!metadata.isFile()) {
    throw validationError({
      code: 'invalid-reference',
      file: path,
      message: 'The bundle reference resolves to a directory instead of a file.',
      fix: 'Point the manifest field at a concrete JSON, Markdown, or source file.',
    })
  }
  if (metadata.size > maxBytes) {
    throw validationError({
      code: 'invalid-content',
      file: path,
      message: `The file is ${metadata.size} bytes; the limit is ${maxBytes} bytes.`,
      fix: 'Split oversized material into smaller course steps and reference those files separately.',
    })
  }
  const value = await readFile(path, 'utf8')
  // The file may have changed between stat and read; keep the post-read guard too.
  if (Buffer.byteLength(value) > maxBytes) {
    throw validationError({
      code: 'invalid-content',
      file: path,
      message: `The file grew beyond the ${maxBytes}-byte limit while it was being read.`,
      fix: 'Split oversized material into smaller course steps and activate again.',
    })
  }
  return value
}

export async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const raw = await readCapped(path, MAX_JSON_BYTES)
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (cause) {
    throw validationError(
      {
        code: 'invalid-json',
        file: path,
        message: cause instanceof Error ? cause.message : 'The file is not valid JSON.',
        fix: 'Repair the JSON syntax in this file without rebuilding unrelated course material.',
      },
      cause,
    )
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw validationError({
      code: 'invalid-manifest',
      file: path,
      field: issue?.path.join('.') || 'root',
      message: issue?.message ?? 'The manifest does not match the course schema.',
      fix: 'Patch the named field to match the bundle schema, preserving stable ids and unrelated files.',
    })
  }
  return parsed.data
}

export async function resolveReference(
  owner: string,
  reference: string,
  root: string,
  filePaths?: Set<string>,
): Promise<string> {
  if (isAbsolute(reference)) {
    throw validationError({
      code: 'invalid-reference',
      file: owner,
      message: `The reference must be relative, but is absolute: ${reference}`,
      fix: 'Replace it with a path relative to this manifest.',
    })
  }
  const lexical = resolve(dirname(owner), reference)
  if (!contained(root, lexical)) {
    throw validationError({
      code: 'invalid-reference',
      file: owner,
      message: `The reference escapes the course root: ${reference}`,
      fix: 'Keep every module, lesson, step, and content file inside the course directory.',
    })
  }
  let canonical: string
  try {
    canonical = await realpath(lexical)
  } catch (cause) {
    throw validationError(
      {
        code: 'missing-reference',
        file: lexical,
        message: `Referenced by ${owner}, but no file exists at the resolved path.`,
        fix: `Create ${lexical} or correct the reference "${reference}" in ${owner}.`,
      },
      cause,
    )
  }
  if (!contained(root, canonical)) {
    throw validationError({
      code: 'invalid-reference',
      file: owner,
      message: `The reference follows a symlink outside the course root: ${reference}`,
      fix: 'Replace the symlink with a real file inside the course directory.',
    })
  }
  filePaths?.add(canonical)
  return canonical
}

export async function markdown(
  owner: string,
  reference: string,
  root: string,
  filePaths?: Set<string>,
): Promise<string> {
  const path = await resolveReference(owner, reference, root, filePaths)
  if (!path.endsWith('.md')) {
    throw validationError({
      code: 'invalid-content',
      file: owner,
      message: `Narrative content must reference a .md file: ${reference}`,
      fix: 'Move the narrative into a Markdown file and update this reference.',
    })
  }
  return readCapped(path, MAX_MARKDOWN_BYTES)
}

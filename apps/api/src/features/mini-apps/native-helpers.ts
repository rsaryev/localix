import { promises as fsp } from 'node:fs'

import { atomicWriteFile, type MiniAppHelpers } from '@localixai/mini-app-sdk/backend'

import { decodeEntities, htmlToText, stripToText } from '../agent-core/tools/web/html-text'
import { extractReadable } from '../agent-core/tools/web/readable-extract'

/**
 * Host implementation of `ctx.helpers` — the {@link MiniAppHelpers} contract is
 * OWNED by `@localixai/mini-app-sdk` (mini apps compile against it); this module
 * provides the runtime. The type is re-exported so the historical import surface
 * (native.ts) stays unchanged.
 *
 * NOTE on `readJson`: the parsed value is `unknown` ON PURPOSE — the file's
 * contents are whatever happens to be on disk, not the fallback's type. Pass a
 * type guard to get `T` back soundly (see the SDK contract docs).
 */
export type { MiniAppHelpers } from '@localixai/mini-app-sdk/backend'

/**
 * Implements the two {@link MiniAppHelpers.readJson} overloads.
 *
 * The guard is OPT-IN, so behavior for every existing caller is byte-for-byte unchanged:
 * with no `isValid`, this returns exactly what `JSON.parse` produced (now honestly typed
 * `unknown` instead of being cast to the fallback's type). Only a caller that ASKS for
 * validation gets the extra `fallback` path.
 */
function readJsonFile(filePath: string, fallback?: unknown): Promise<unknown>
function readJsonFile<T>(
  filePath: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): Promise<T>
async function readJsonFile(
  filePath: string,
  fallback?: unknown,
  isValid?: (value: unknown) => boolean,
): Promise<unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await fsp.readFile(filePath, 'utf8')) as unknown
  } catch {
    return fallback
  }
  return isValid && !isValid(parsed) ? fallback : parsed
}

export function makeHelpers(): MiniAppHelpers {
  return {
    configNumber(value, fallback) {
      if (typeof value === 'number' && Number.isFinite(value)) return value
      if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value)
        if (Number.isFinite(n)) return n
      }
      return fallback
    },
    configBoolean(value, fallback) {
      if (typeof value === 'boolean') return value
      if (typeof value === 'string') return value === 'true' || value === '1'
      return fallback
    },
    configString(value, fallback = '') {
      return typeof value === 'string' && value.trim() ? value.trim() : fallback
    },
    errorResult(content, opts) {
      return {
        content,
        isError: true,
        error: {
          kind: 'execution',
          message: content,
          userMessage: opts?.userMessage ?? content,
          retryable: opts?.retryable ?? false,
          fatal: false,
        },
      }
    },
    withTimeoutSignal(parent, timeoutMs) {
      const controller = new AbortController()
      let timedOut = false
      const onAbort = () => controller.abort()
      parent?.addEventListener('abort', onAbort, { once: true })
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
      return {
        signal: controller.signal,
        didTimeout: () => timedOut,
        dispose: () => {
          clearTimeout(timer)
          parent?.removeEventListener('abort', onAbort)
        },
      }
    },
    readJson: readJsonFile,
    /**
     * Atomic on purpose, and this is the highest-leverage place for it: every mini app
     * gets this helper, and `readJson` + `writeJson` is the whole-file read-modify-write
     * loop extension authors naturally write (`writeJson(f, [...names, name])`). A
     * plain writeFile truncates and then writes, so an interrupted save leaves a
     * half-file and takes every OTHER key with it — a mini app author gets that failure
     * mode by default, in their own store, without ever choosing it. temp+rename means
     * the file is the old one or the new one, never a partial.
     */
    async writeJson(filePath, value) {
      await atomicWriteFile(filePath, JSON.stringify(value, null, 2))
    },
    // Text utilities shared with the central research reader (agent-core html-text) so
    // drop-in mini apps don't each carry their own entity/tag-stripping copy. A pure
    // PARSING kernel a mini app unit-tests standalone may still inline its own (e.g.
    // native mini app tools); adapters should reach for these.
    decodeEntities,
    htmlToText,
    stripToText,
    extractReadable,
  }
}

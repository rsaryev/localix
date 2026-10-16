import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import { resolveDefaultUserId } from '../../lib/env'
import {
  charLimitForScope,
  entriesChars,
  formatUsage,
  memoriesBaseDir,
  memoryFilePath,
  mutateMemoryFile,
  readMemoryFile,
  usageOf,
  writeMemoryFile,
  type MemoryUsage,
} from './file-store'

/** A stored memory note. `projectId === ''` means a global (every-session) note. */
export interface MemoryNote {
  key: string
  value: string
  /** '' = global; 'session:<id>' = single conversation; else a project id. */
  projectId: string
}

function scopeLabel(scope: string): 'session' | 'project' | 'global' {
  if (!scope) return 'global'
  return scope.startsWith('session:') ? 'session' : 'project'
}

/** Thrown by `set` when the write would exceed the scope file's char budget. */
export class MemoryBudgetError extends Error {
  readonly usage: MemoryUsage
  constructor(scope: string, usage: MemoryUsage, existingKeys: string[]) {
    const keys = existingKeys.length > 0 ? ` Existing keys: ${existingKeys.join(', ')}.` : ''
    super(
      `Memory budget exceeded for the ${scopeLabel(scope)} scope (currently ${formatUsage(usage)}). ` +
        `The write was rejected — nothing was saved. Consolidate or delete entries to free space.${keys}`,
    )
    this.name = 'MemoryBudgetError'
    this.usage = usage
  }
}

export interface MemoryRepositoryOptions {
  /** Override the memories directory (tests). Defaults to `~/.localix/memories`. */
  baseDir?: string
  /** Override the default (top-level-paths) user id. */
  defaultUserId?: string
}

/**
 * Markdown-file note store under `~/.localix/memories` (one user-editable file
 * per scope — see file-store.ts), scoped per (user, scope, key). Reads pass the
 * set of visible scopes (session/project/global); writes target one scope and
 * are REJECTED (MemoryBudgetError) when they would exceed the file's char budget.
 *
 * The `db` handle is used only for a one-time lazy migration of legacy
 * `agent_memory` rows into the files (rows are kept; a `.migrated` marker —
 * or a pre-existing MEMORY.md — prevents re-runs).
 */
export function createMemoryRepository(
  db: Kysely<AppDatabase>,
  options: MemoryRepositoryOptions = {},
) {
  const baseDir = options.baseDir ?? memoriesBaseDir()
  const defaultUserId = options.defaultUserId ?? resolveDefaultUserId()
  const fileFor = (userId: string, scope: string) =>
    memoryFilePath(baseDir, userId, scope, defaultUserId)

  let migration: Promise<void> | null = null
  const ensureMigrated = (): Promise<void> => {
    // Reset the memo on failure so a transient fs/db error during this one-time
    // legacy migration doesn't wedge EVERY later memory op behind a permanently-
    // rejected promise — the next call retries instead.
    migration ??= (async () => {
      const marker = path.join(baseDir, '.migrated')
      if (existsSync(marker) || existsSync(path.join(baseDir, 'MEMORY.md'))) return
      const rows = await db
        .selectFrom('agent_memory')
        .select(['user_id', 'project_id', 'key', 'value', 'updated_at'])
        .execute()
      // Group rows by (user, scope) → one file each. DB rows are NOT deleted.
      const byFile = new Map<string, { key: string; value: string; updatedAt?: string }[]>()
      for (const row of rows) {
        const file = fileFor(row.user_id, row.project_id)
        const list = byFile.get(file) ?? []
        list.push({ key: row.key, value: row.value, updatedAt: row.updated_at ?? undefined })
        byFile.set(file, list)
      }
      // Scope files do not overlap. Write them together; the marker still lands
      // only after every file succeeds, preserving the migration's all-complete
      // retry contract.
      await Promise.all(
        [...byFile].map(([file, entries]) => {
          entries.sort((a, b) => a.key.localeCompare(b.key))
          return writeMemoryFile(file, entries)
        }),
      )
      await mkdir(baseDir, { recursive: true })
      await writeFile(marker, `migrated from agent_memory at ${new Date().toISOString()}\n`, 'utf8')
    })().catch((err) => {
      migration = null
      throw err
    })
    return migration
  }

  const loadScope = async (userId: string, scope: string) => readMemoryFile(fileFor(userId, scope))

  return {
    /** Notes for a key across the given scopes (caller picks the narrowest). */
    async getByKey(userId: string, key: string, scopes: string[]): Promise<MemoryNote[]> {
      await ensureMigrated()
      const loaded = await Promise.all(scopes.map((scope) => loadScope(userId, scope)))
      const notes: MemoryNote[] = []
      scopes.forEach((scope, i) => {
        const entry = loaded[i].find((e) => e.key === key)
        if (entry) notes.push({ key: entry.key, value: entry.value, projectId: scope })
      })
      return notes
    },

    /** All notes visible in the given scopes, ordered by `key` or last update desc. */
    async list(
      userId: string,
      scopes: string[],
      orderBy: 'key' | 'recent' = 'key',
    ): Promise<MemoryNote[]> {
      await ensureMigrated()
      const loaded = await Promise.all(scopes.map((scope) => loadScope(userId, scope)))
      const notes: (MemoryNote & { updatedAt?: string })[] = []
      scopes.forEach((scope, i) => {
        for (const entry of loaded[i]) {
          notes.push({
            key: entry.key,
            value: entry.value,
            projectId: scope,
            updatedAt: entry.updatedAt,
          })
        }
      })
      if (orderBy === 'recent') {
        notes.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
      } else {
        notes.sort((a, b) => a.key.localeCompare(b.key))
      }
      return notes.map(({ key, value, projectId }) => ({ key, value, projectId }))
    },

    /**
     * Notes + aggregate budget usage in ONE pass — loads each scope file once.
     * The prompt-assembly path needs both, and calling `list` + `usage` separately
     * read + parsed every scope file twice per agent turn.
     */
    async listWithUsage(
      userId: string,
      scopes: string[],
      orderBy: 'key' | 'recent' = 'key',
    ): Promise<{ notes: MemoryNote[]; usage: MemoryUsage }> {
      await ensureMigrated()
      const loaded = await Promise.all(scopes.map((scope) => loadScope(userId, scope)))
      const notes: (MemoryNote & { updatedAt?: string })[] = []
      let chars = 0
      let limit = 0
      scopes.forEach((scope, i) => {
        for (const entry of loaded[i]) {
          notes.push({
            key: entry.key,
            value: entry.value,
            projectId: scope,
            updatedAt: entry.updatedAt,
          })
        }
        chars += entriesChars(loaded[i])
        limit += charLimitForScope(scope)
      })
      if (orderBy === 'recent')
        notes.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
      else notes.sort((a, b) => a.key.localeCompare(b.key))
      return {
        notes: notes.map(({ key, value, projectId }) => ({ key, value, projectId })),
        usage: usageOf(chars, limit),
      }
    },

    /**
     * UPSERT a note into one scope (replaces value on (user, scope, key) clash).
     * Throws {@link MemoryBudgetError} when the result would exceed the scope
     * file's char budget — nothing is written in that case.
     */
    async set(
      userId: string,
      scope: string,
      key: string,
      value: string,
      now: string,
    ): Promise<void> {
      await ensureMigrated()
      const limit = charLimitForScope(scope)
      // Read-modify-write INSIDE the per-path queue so a concurrent same-scope set
      // (parent + sub-agent both writing global) can't clobber the other's key.
      await mutateMemoryFile(fileFor(userId, scope), (entries) => {
        const next = entries.filter((e) => e.key !== key)
        next.push({ key, value, updatedAt: now })
        if (entriesChars(next) > limit) {
          throw new MemoryBudgetError(
            scope,
            usageOf(entriesChars(entries), limit),
            entries.map((e) => e.key),
          )
        }
        next.sort((a, b) => a.key.localeCompare(b.key))
        return { entries: next, result: undefined }
      })
    },

    /** Delete a key across the given scopes. Returns true if anything was removed. */
    async deleteByKey(userId: string, key: string, scopes: string[]): Promise<boolean> {
      await ensureMigrated()
      const removed = await Promise.all(
        scopes.map((scope) =>
          mutateMemoryFile(fileFor(userId, scope), (entries) => {
            const next = entries.filter((e) => e.key !== key)
            const changed = next.length !== entries.length
            // null entries → skip the write (don't create a spurious empty file when
            // the key wasn't in this scope).
            return { entries: changed ? next : null, result: changed }
          }),
        ),
      )
      return removed.some(Boolean)
    },

    /** Aggregate budget usage across the given scopes (chars + limits summed). */
    async usage(userId: string, scopes: string[]): Promise<MemoryUsage> {
      await ensureMigrated()
      const loaded = await Promise.all(scopes.map((scope) => loadScope(userId, scope)))
      let chars = 0
      let limit = 0
      scopes.forEach((scope, i) => {
        chars += entriesChars(loaded[i])
        limit += charLimitForScope(scope)
      })
      return usageOf(chars, limit)
    },
  }
}

export type MemoryRepository = ReturnType<typeof createMemoryRepository>

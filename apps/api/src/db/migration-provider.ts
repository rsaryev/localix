import { promises as fs } from 'node:fs'
import path from 'node:path'
import { FileMigrationProvider, type Migration, type MigrationProvider } from 'kysely/migration'
import { resolveBundledRoot } from '../lib/bundled-root'
import type { MigrationSources } from './migration-ledger'

/** The frozen first migration. Schema changes after it are new files, never edits to it. */
export const BASELINE_MIGRATION = '20260601T000000_init_schema'

/**
 * `true` in the packaged bundle, where `scripts/embed-migrations-plugin.mjs` compiles the migrations
 * into `server.js`; undefined when the API runs from source, where the files are read from disk. The
 * `typeof` guard keeps the source run from referencing an identifier nothing defined.
 */
declare const __LOCALIX_EMBEDDED_MIGRATIONS__: boolean | undefined
const embedded = typeof __LOCALIX_EMBEDDED_MIGRATIONS__ !== 'undefined'

interface EmbeddedMigration {
  migration: Migration
  source: string
}

/** The bundle's migrations. Only reachable when `embedded`, so a source run never resolves it. */
async function embeddedMigrations(): Promise<Record<string, EmbeddedMigration>> {
  // The specifier is a virtual module the bundler plugin answers; it does not exist on disk.
  const module = (await import('localix:embedded-migrations' as string)) as {
    EMBEDDED_MIGRATIONS: Record<string, EmbeddedMigration>
  }
  return module.EMBEDDED_MIGRATIONS
}

let shipped: MigrationProvider | undefined

/** Where the shipped migration files live in a source run (the source tree's `migrations/`). */
export function shippedMigrationFolder(): string {
  return resolveBundledRoot({
    moduleUrl: import.meta.url,
    dirName: 'migrations',
    sourceRelative: '../../migrations',
  })
}

/** The shipped migrations, for startup and the read-only audit alike. One instance per process,
 *  so the reference schema `validateSchema` builds from it is built once. */
export function shippedMigrations(): MigrationProvider {
  shipped ??= embedded
    ? {
        async getMigrations() {
          const all = await embeddedMigrations()
          return Object.fromEntries(
            Object.entries(all).map(([name, { migration }]) => [name, migration]),
          )
        },
      }
    : new FileMigrationProvider({ fs, path, migrationFolder: shippedMigrationFolder() })
  return shipped
}

/** Where the ledger reads the shipped migrations' text: embedded in the bundle, else the folder. */
export async function shippedMigrationSources(): Promise<MigrationSources> {
  if (!embedded) return shippedMigrationFolder()
  const all = await embeddedMigrations()
  return (name) => all[name]?.source
}

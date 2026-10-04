import { promises as fs } from 'node:fs'
import path from 'node:path'
import { FileMigrationProvider, type MigrationProvider } from 'kysely/migration'
import { resolveBundledRoot } from '../lib/bundled-root'

/** The frozen first migration. Schema changes after it are new files, never edits to it. */
export const BASELINE_MIGRATION = '20260601T000000_init_schema'

let shipped: MigrationProvider | undefined

/** Where the shipped migration files live — source tree or the bundle's staged sibling. */
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
  shipped ??= new FileMigrationProvider({
    fs,
    path,
    migrationFolder: shippedMigrationFolder(),
  })
  return shipped
}

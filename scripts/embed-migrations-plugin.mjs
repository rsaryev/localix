// Bundle the API's migrations INTO `server.js`, so the packaged app ships no `migrations/` folder and
// no vendored `kysely` beside it.
//
// The bundle used to carry the migration `.ts` files as loose siblings: a file provider imported them
// at start-up, and each one's `import 'kysely'` needed a `node_modules/kysely` copied next to them.
// That is the one thing that kept the API from being a single bundle. Every other reference app that
// owns a local database (Spacedrive, GitButler, Buzz) compiles its migrations into the binary; this
// does the same for Bun.
//
// The plugin answers one virtual module, `localix:embedded-migrations`:
//
//   export const EMBEDDED_MIGRATIONS: Record<name, { migration: { up, down? }, source: string }>
//
// `migration` is a static import, so the bundler resolves `kysely` into the bundle. `source` is the
// file's text, which the ledger digests exactly as it digests the loose file today, so a database
// moved between the dev server and the packaged app reads the same digests. (Bun's bundler ignores
// `with { type: 'text' }` on a `.ts` file, so the text is embedded by this plugin instead.)
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const EMBEDDED_MIGRATIONS_MODULE = 'localix:embedded-migrations'
/** Defined as `true` in the bundle; absent when the API runs from source, where files are read. */
export const EMBEDDED_MIGRATIONS_FLAG = '__LOCALIX_EMBEDDED_MIGRATIONS__'

const MIGRATION_FILE = /^(\d{8}T\d{6}_[A-Za-z0-9_]+)\.ts$/u

/**
 * The migrations in `dir`, oldest first: `{ name, path, source }` for each `<timestamp>_<name>.ts`.
 * A code file that does not match that name is an error, not a skip: the Kysely migrator would have
 * run it from a loose folder, so silently leaving it out of the bundle would ship a schema the
 * source run does not have.
 */
export function listMigrations(dir) {
  return readdirSync(dir)
    .filter((file) => /\.[cm]?[jt]s$/u.test(file))
    .map((file) => {
      const match = MIGRATION_FILE.exec(file)
      if (!match) throw new Error(`${join(dir, file)} is not named <timestamp>_<name>.ts`)
      return { name: match[1], path: join(dir, file) }
    })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map((entry) => ({ ...entry, source: readFileSync(entry.path, 'utf8') }))
}

/** The text of the virtual module for these migrations. */
export function embeddedMigrationsSource(migrations) {
  const imports = migrations.map(
    ({ path }, index) => `import * as migration${index} from ${JSON.stringify(path)}`,
  )
  const entries = migrations.map(
    ({ name, source }, index) =>
      `  ${JSON.stringify(name)}: { migration: migration${index}, source: ${JSON.stringify(source)} },`,
  )
  return [...imports, 'export const EMBEDDED_MIGRATIONS = {', ...entries, '}', ''].join('\n')
}

/** A Bun bundler plugin serving `localix:embedded-migrations` from the migrations in `dir`. */
export function embeddedMigrationsPlugin(dir) {
  return {
    name: 'localix-embedded-migrations',
    setup(build) {
      build.onResolve({ filter: /^localix:embedded-migrations$/u }, () => ({
        path: EMBEDDED_MIGRATIONS_MODULE,
        namespace: 'localix-embedded',
      }))
      build.onLoad({ filter: /.*/u, namespace: 'localix-embedded' }, () => {
        const migrations = listMigrations(dir)
        if (migrations.length === 0) throw new Error(`No migrations found in ${dir}`)
        return { contents: embeddedMigrationsSource(migrations), loader: 'js' }
      })
    },
  }
}

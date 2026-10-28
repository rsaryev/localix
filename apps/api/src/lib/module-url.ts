import { fileURLToPath, pathToFileURL } from 'node:url'
import { copyFileSync, existsSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'

/**
 * file:// import URL for a drop-in module, cache-busted by mtime so edits to a
 * bundled mini app `.mjs` are picked up WITHOUT a full server
 * restart. The ESM loader caches imports by URL forever; appending
 * `?m=<mtimeMs>` keeps an unchanged file on the same (cached) URL — zero prod
 * cost, since bundled drop-ins don't change there — while an edit yields a fresh
 * URL that re-imports. Falls back to the bare URL if the file can't be stat'd.
 *
 * Shared by the external executor and mini app native loaders so hot-reload
 * behaves identically across code-bearing extension kinds.
 */
export function freshModuleUrl(absPath: string): string {
  const base = pathToFileURL(absPath).href
  try {
    return `${base}?m=${statSync(absPath).mtimeMs}`
  } catch {
    return base
  }
}

/**
 * The URL an EDITED module is imported from, once this process has loaded an earlier version.
 *
 * The `?m=` cache-buster above does not work under Bun: its module cache is keyed by the file's
 * canonical path and ignores the query, so re-importing an edited `index.bundle.mjs` returned the
 * first version for the life of the process — a bundled mini app rebuilt in development kept its
 * old backend until the API restarted. A distinct PATH is a distinct module, so the edited file is
 * copied beside itself under a unique name: beside, because a split bundle imports its chunks by
 * relative path and they must still resolve. Only an edit after a first load pays for a copy; an
 * unchanged file — every file of a packaged app — keeps importing its own path.
 */
function hotCopyUrl(absPath: string, baseUrl: string): string {
  const ext = extname(absPath)
  const stamp = createHash('sha256').update(baseUrl).digest('hex').slice(0, 12)
  const copy = join(dirname(absPath), `${basename(absPath, ext)}.hot-${stamp}${ext || '.mjs'}`)
  copyFileSync(absPath, copy)
  // By its canonical path: Bun's resolver cannot see a file created after it cached a directory
  // reached through a symlink (macOS's `/var` → `/private/var` is enough), and then reports the
  // copy it was just handed as missing.
  return pathToFileURL(realpathSync(copy)).href
}

interface ModuleImportGeneration {
  baseUrl: string
  /** The URL this version was imported from: its own path, or a hot copy after an edit. */
  importUrl?: string
  generation: number
  recoveredUrl?: string
  recoveredArtifact?: Blob
}

const moduleImportGenerations = new Map<string, ModuleImportGeneration>()
const retryArtifacts = new Set<string>()

function isStaleBunSyntaxBuildMessage(
  error: unknown,
  absPath: string,
  importedBaseUrl: string,
): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { name?: unknown; position?: unknown }
  if (value.name !== 'BuildMessage' || !value.position || typeof value.position !== 'object') {
    return false
  }
  const position = value.position as {
    file?: unknown
    line?: unknown
    column?: unknown
    lineText?: unknown
  }
  if (
    typeof position.file !== 'string' ||
    typeof position.line !== 'number' ||
    typeof position.column !== 'number' ||
    typeof position.lineText !== 'string'
  ) {
    return false
  }
  if (freshModuleUrl(absPath) !== importedBaseUrl) return true
  try {
    const currentLine = readFileSync(position.file, 'utf8').split(/\r?\n/u)[position.line - 1]
    return currentLine !== position.lineText
  } catch {
    return false
  }
}

process.once('exit', () => {
  for (const dir of retryArtifacts) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Best-effort temp cleanup during process teardown.
    }
  }
})

/**
 * Import a hot drop-in without freezing a transient parse/write failure forever.
 *
 * JavaScript runtimes cache rejected dynamic imports by URL too. If discovery
 * catches a bundle halfway through a refresh, importing the now-valid file again
 * with the same mtime URL can keep returning the old parse error. A failed
 * attempt advances a small per-path generation; unchanged successful modules
 * still reuse their cached URL.
 */
export async function importFreshModule(absPath: string): Promise<unknown> {
  const baseUrl = freshModuleUrl(absPath)
  const previous = moduleImportGenerations.get(absPath)
  const state: ModuleImportGeneration =
    previous?.baseUrl === baseUrl ? previous : { baseUrl, generation: 0 }
  moduleImportGenerations.set(absPath, state)
  if (state.recoveredUrl) {
    // The recovered bundle lives in $TMPDIR, which is NOT ours to rely on: the OS purges temp
    // files, and this process deletes its own artifacts on exit. Caching the URL without
    // checking that the file is still there turned a transient miss into a permanent one — a
    // path whose recovery file had vanished failed with "Cannot find module" on every later
    // import, even though the real module on disk was fine. Do not ask Bun to resolve a known-
    // missing URL: it also caches the missing parent directory and rejects new files recreated
    // beneath it.
    const recoveredPath = fileURLToPath(state.recoveredUrl)
    if (!existsSync(recoveredPath) && state.recoveredArtifact) {
      await mkdir(dirname(recoveredPath), { recursive: true })
      await Bun.write(recoveredPath, state.recoveredArtifact)
    }
    try {
      return await import(state.recoveredUrl)
    } catch (error) {
      // Narrowed to the artifact itself, not to a boolean: `Bun.write` needs the Blob, and a
      // truthiness check on a separate const does not narrow the field for TypeScript.
      const retainedArtifact =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ERR_MODULE_NOT_FOUND'
          ? state.recoveredArtifact
          : undefined
      if (retainedArtifact) {
        // Each generation gets a sibling directory below so deletion between existsSync and
        // import can poison only this retired directory, not the replacement bundle. Restore
        // the retired file too: Bun.build retains resolver state for imported module paths.
        await mkdir(dirname(recoveredPath), { recursive: true })
        await Bun.write(recoveredPath, retainedArtifact)
      } else {
        // A real module rejection must rebuild the repaired source, even when its mtime URL did
        // not change. Reusing the last successful artifact here would weaken that retry contract.
        state.recoveredArtifact = undefined
      }
    }
    state.recoveredUrl = undefined
    state.generation += 1
  }

  if (state.generation > 0) {
    // Bun caches a rejected file import by canonical path even when its query
    // changes. Re-bundle the repaired entry in memory and import that distinct
    // module identity. Bundling also preserves provider/mini app relative imports.
    let recoveredArtifact = state.recoveredArtifact
    if (!recoveredArtifact) {
      const built = await Bun.build({
        entrypoints: [absPath],
        target: 'bun',
        format: 'esm',
        packages: 'bundle',
        // The build's own messages name the file and the import; a thrown `Bundle failed` names
        // neither, and was all a person saw of a backend that could not load.
        throw: false,
      })
      if (!built.success || !built.outputs[0]) {
        state.generation += 1
        throw new Error(built.logs.map(String).join('; ') || `Could not rebuild ${absPath}`)
      }
      recoveredArtifact = built.outputs[0]
    }
    const digest = createHash('sha256').update(baseUrl).digest('hex').slice(0, 20)
    const retryDir = join(
      tmpdir(),
      `localix-module-retry-${process.pid}-${state.generation}-${digest}`,
    )
    await mkdir(retryDir, { recursive: true })
    const retryPath = join(retryDir, 'module.mjs')
    await Bun.write(retryPath, recoveredArtifact)
    retryArtifacts.add(retryDir)
    const retryUrl = pathToFileURL(retryPath).href
    try {
      const loaded = await import(retryUrl)
      state.recoveredUrl = retryUrl
      state.recoveredArtifact = recoveredArtifact
      return loaded
    } catch (error) {
      state.recoveredArtifact = undefined
      state.generation += 1
      throw error
    }
  }

  // The first version loads from its own path; a later edit of a module this process already
  // loaded loads from a hot copy (see `hotCopyUrl`). The choice is kept per version, so an
  // unchanged file keeps returning the same module instance.
  state.importUrl ??= previous?.importUrl ? hotCopyUrl(absPath, baseUrl) : baseUrl
  try {
    return await import(state.importUrl)
  } catch (error) {
    state.importUrl = undefined
    state.generation += 1
    // A synchronized split bundle can be valid on disk yet lose a Bun import race while its
    // directory generation changes. Bun reports that loader failure as a positioned
    // `BuildMessage` and caches the rejected URL. Recover in THIS caller: waiting for another
    // mini app consumer made startup emit a false warning even though a later host loaded the same
    // backend successfully. A genuine syntax error still rejects; runtime exceptions are never
    // retried inside the same call (a later caller may still retry by the documented generation
    // recovery path above).
    if (isStaleBunSyntaxBuildMessage(error, absPath, baseUrl)) return importFreshModule(absPath)
    throw error
  }
}

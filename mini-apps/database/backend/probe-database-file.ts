/**
 * "Is this path a database, and which one?" — the server side of opening a `.db` file.
 *
 * The UI cannot answer this: it has no filesystem, and the extension alone is not an
 * answer (see the header of `shared/database-file.ts` — `.db` names SQLite and
 * a dozen unrelated formats). So the tab asks here before it creates a connection,
 * which is what keeps a mistyped path or a Berkeley DB from being SAVED as a broken
 * SQLite connection the user then has to find and delete.
 *
 * Reads {@link DATABASE_HEADER_BYTES} bytes and nothing more: no driver is opened, no
 * schema is read, nothing is persisted. A probe of a file that turns out not to be a
 * database costs one `open`/`read`/`close`.
 */
import { open } from 'node:fs/promises'

import {
  DATABASE_HEADER_BYTES,
  isDatabaseFilePath,
  sniffDatabaseDialect,
  type DatabaseFileProbe,
} from '../shared/database-file'

/**
 * Identify the database file at `path`, or say why it isn't one.
 *
 * Never throws: every outcome — missing file, a directory, no permission, wrong magic —
 * is a `{ openable: false }` answer the tab renders as a sentence. A probe failure is
 * information about the file, not a server fault.
 */
export async function probeDatabaseFile(path: string): Promise<DatabaseFileProbe> {
  // The extension gate runs first so a probe can never be used to stat arbitrary paths
  // for their readability — it answers only about files this mini app claims to open.
  if (!isDatabaseFilePath(path)) return { openable: false, reason: 'not-a-database-extension' }

  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(path, 'r')
    const header = new Uint8Array(DATABASE_HEADER_BYTES)
    // A file shorter than the header is not an error — `bytesRead` bounds the slice and
    // the sniffer's length checks reject it as unrecognized, which a 0-byte file is.
    const { bytesRead } = await handle.read(header, 0, DATABASE_HEADER_BYTES, 0)
    const dialect = sniffDatabaseDialect(header.subarray(0, bytesRead))
    return dialect
      ? { openable: true, dialect }
      : { openable: false, reason: 'unrecognized-format' }
  } catch {
    return { openable: false, reason: 'unreadable' }
  } finally {
    await handle?.close().catch(() => {
      /* the read already answered; a failed close must not rewrite the verdict */
    })
  }
}

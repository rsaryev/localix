/**
 * The `database_client` tool's connection verbs: list, connect, test, reconnect, disconnect, remove.
 *
 * Before this the agent could only say "ask the user to connect one in the Database workbench":
 * a task that needed a database stopped at a form the agent could have filled. It goes through
 * the SAME service calls the workbench form uses, so validation (connect runs a probe before it
 * saves), secret references (`${secret:KEY}` resolve server-side), SSH host-key pinning and
 * duplicate folding (re-adding a saved target reopens that entry) are one implementation.
 *
 * A reply never echoes a password or a full URL back into the transcript: connections are named
 * by display name, engine and id, as the workbench list names them.
 */
import type { ConnectRequest, DbConnectionInfo } from './contracts'
import { dbConnectionConfigSchema } from './contracts'
import { DATABASE_DRIVERS, isFileDatabaseDialect, type DbDialect } from '../shared/driver-catalog'
import type { DatabaseToolInput } from './database-tool-schema'
import { fileUrlPath } from './file-url'

export interface DbConnectionsPort {
  list(userId: string): Promise<DbConnectionInfo[]>
  connect(userId: string, req: ConnectRequest): Promise<DbConnectionInfo>
  test(userId: string, config: ConnectRequest['config']): Promise<unknown>
  reconnect(userId: string, id: string): Promise<DbConnectionInfo | null>
  disconnect(userId: string, id: string): Promise<boolean>
  remove(userId: string, id: string): Promise<boolean>
}

type Result = { content: string; isError?: boolean; details?: unknown }

const describe = (c: DbConnectionInfo) =>
  `${c.name} [${c.dialect}]${c.readonly ? ' (read-only)' : ''} — ${c.connected ? 'connected' : 'disconnected'} — id: ${c.id}`

/** The engine a url or file names, or null when it is ambiguous (http(s)://, an unknown file). */
export function inferEngine(input: Pick<DatabaseToolInput, 'url' | 'file'>): DbDialect | null {
  if (input.file) {
    return /\.(db|sqlite3?|db3|s3db|sl3)$/i.test(input.file) || input.file === ':memory:'
      ? 'sqlite'
      : null
  }
  const scheme = /^([a-z][\w+.-]*):\/\//i.exec(input.url?.trim() ?? '')?.[1]?.toLowerCase()
  if (!scheme) return null
  const matches = DATABASE_DRIVERS.filter((driver) => driver.urlSchemes.includes(scheme))
  return matches.length === 1 ? matches[0]!.id : null
}

/** The tool's flat fields → the service's validated config, or the reason they do not make one. */
export function buildConnectionConfig(
  input: DatabaseToolInput,
): { ok: true; config: ConnectRequest['config'] } | { ok: false; error: string } {
  const engine = (input.engine as DbDialect | undefined) ?? inferEngine(input)
  if (!engine) {
    return {
      ok: false,
      error: `Cannot tell the engine from ${input.file ? 'this file' : 'this url'} — pass engine (one of ${DATABASE_DRIVERS.map((d) => d.id).join(', ')}).`,
    }
  }
  const raw = isFileDatabaseDialect(engine)
    ? {
        dialect: engine,
        file:
          input.file ??
          (input.url === undefined ? undefined : (fileUrlPath(input.url) ?? input.url)),
      }
    : {
        dialect: engine,
        ...(input.url
          ? { url: input.url }
          : {
              host: input.host,
              port: input.port,
              user: input.user,
              password: input.password,
              database: input.database,
            }),
      }
  const parsed = dbConnectionConfigSchema.safeParse({
    ...raw,
    ...(input.readonly !== undefined ? { readonly: input.readonly } : {}),
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join(' ') }
  }
  return { ok: true, config: parsed.data }
}

const failure = (verb: string, err: unknown): Result => ({
  content: `Could not ${verb}: ${err instanceof Error ? err.message : String(err)}`,
  isError: true,
})

export async function runConnectionAction(
  port: DbConnectionsPort,
  userId: string,
  input: DatabaseToolInput,
): Promise<Result> {
  if (input.action === 'connections') {
    const all = await port.list(userId)
    if (all.length === 0) {
      return { content: 'No saved connections. Add one with action="connect".' }
    }
    return {
      content: `${all.length} saved connection(s):\n${all.map((c) => `- ${describe(c)}`).join('\n')}`,
      details: {
        connections: all.map(({ id, name, dialect, connected }) => ({
          id,
          name,
          dialect,
          connected,
        })),
      },
    }
  }
  if (input.action === 'connect' || input.action === 'test') {
    const built = buildConnectionConfig(input)
    if (!built.ok) return { content: built.error, isError: true }
    if (input.action === 'test') {
      try {
        await port.test(userId, built.config)
        return { content: `Connection works (${built.config.dialect}). Nothing was saved.` }
      } catch (err) {
        return failure('connect', err)
      }
    }
    try {
      const connection = await port.connect(userId, { config: built.config, name: input.name })
      return {
        content: `Connected: ${describe(connection)}. Use this id as connection_id.`,
        details: {
          connection: { id: connection.id, name: connection.name, dialect: connection.dialect },
        },
      }
    } catch (err) {
      return failure('connect', err)
    }
  }
  const id = input.connection_id!
  try {
    if (input.action === 'reconnect') {
      const connection = await port.reconnect(userId, id)
      return connection
        ? { content: `Reconnected: ${describe(connection)}.` }
        : { content: `No saved connection with id "${id}".`, isError: true }
    }
    const done =
      input.action === 'disconnect'
        ? await port.disconnect(userId, id)
        : await port.remove(userId, id)
    if (!done) return { content: `No saved connection with id "${id}".`, isError: true }
    return {
      content:
        input.action === 'disconnect'
          ? `Disconnected "${id}". It stays saved; reconnect with action="reconnect".`
          : `Removed the saved connection "${id}".`,
    }
  } catch (err) {
    return failure(input.action, err)
  }
}

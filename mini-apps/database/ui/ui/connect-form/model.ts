/** Pure model helpers for the connect/edit form — no React in here. */
import type {
  DbConnectionConfig,
  DbConnectionInfo,
  DbDialect,
  DbSslConfig,
  SshTunnelConfig,
  UpdateConfigRequest,
} from '../../dbClient'
import { getDatabaseDriverManifest, isFileDatabaseDialect } from '../../../shared/driver-catalog'

/** In edit mode the form re-points an EXISTING connection while keeping its id. */
export interface ConnectFormEdit {
  connection: DbConnectionInfo
  config: DbConnectionConfig
  save: (req: UpdateConfigRequest) => Promise<DbConnectionInfo>
}

export function errCode(e: unknown): string | null {
  return e &&
    typeof e === 'object' &&
    'code' in e &&
    typeof (e as { code: unknown }).code === 'string'
    ? (e as { code: string }).code
    : null
}

export interface TlsAdvanced {
  rejectUnauthorized: boolean
  ca: string
  cert: string
  key: string
}

export const EMPTY_TLS_ADVANCED: TlsAdvanced = {
  rejectUnauthorized: true,
  ca: '',
  cert: '',
  key: '',
}

export function tlsClientIdentityIssue(enabled: boolean, tls: TlsAdvanced): string | null {
  if (!enabled) return null
  const hasCert = !!tls.cert.trim()
  const hasKey = !!tls.key.trim()
  return hasCert === hasKey ? null : 'Client certificate and key are both required.'
}

export interface ConnectionFields {
  host: string
  port: string
  user: string
  password: string
  database: string
  tls: boolean
  adv: TlsAdvanced
}

export interface ParsedConnectionUrl extends ConnectionFields {
  normalizedUrl: string
}

function decodeUrlPart(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Parse a pasted URL into the same editable fields used by manual entry.
 *
 * A connection string is an IMPORT affordance, not a second mutually-exclusive form. The selected manifest validates schemes and supplies
 * the default port; no driver-library knowledge leaks into the component.
 */
export function parseConnectionUrl(raw: string, dialect: DbDialect): ParsedConnectionUrl {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('Paste a connection URL first.')
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('This is not a valid connection URL.')
  }
  const manifest = getDatabaseDriverManifest(dialect)
  const scheme = url.protocol.replace(/:$/, '').toLowerCase()
  if (!manifest.urlSchemes.includes(scheme)) {
    throw new Error(
      `${manifest.label} expects ${manifest.urlSchemes.map((item) => `${item}://`).join(' or ')}`,
    )
  }
  const secureScheme = scheme === 'https' || scheme === 'rediss' || scheme === 'clickhouses'
  const sslMode = url.searchParams.get('sslmode')?.toLowerCase()
  const tls = secureScheme || (!!sslMode && !['disable', 'false', 'off'].includes(sslMode))
  const defaultPort = tls ? (manifest.defaultTlsPort ?? manifest.defaultPort) : manifest.defaultPort
  const database = decodeUrlPart(url.pathname.replace(/^\/+/, '').split('/')[0] ?? '')

  return {
    normalizedUrl: trimmed,
    host: url.hostname,
    port: url.port || (defaultPort ? String(defaultPort) : ''),
    user: decodeUrlPart(url.username),
    password: decodeUrlPart(url.password),
    database,
    tls,
    adv: EMPTY_TLS_ADVANCED,
  }
}

function tlsFields(
  ssl: DbSslConfig | undefined,
  fallbackEnabled = false,
): Pick<ConnectionFields, 'tls' | 'adv'> {
  const advanced = ssl && typeof ssl === 'object' ? ssl : undefined
  return {
    // An explicit false beside a URL overrides its secure scheme/sslmode, just as the
    // backend client option does. Undefined delegates to the parsed URL.
    tls: ssl === undefined ? fallbackEnabled : ssl !== false,
    adv: advanced
      ? {
          rejectUnauthorized: advanced.rejectUnauthorized ?? true,
          ca: advanced.ca ?? '',
          cert: advanced.cert ?? '',
          key: advanced.key ?? '',
        }
      : EMPTY_TLS_ADVANCED,
  }
}

/** Derive one uniform set of editor fields from either stored network shape. */
export function initialFields(
  config: DbConnectionConfig,
): ConnectionFields & { importUrl: string } {
  if ('file' in config) {
    return {
      host: '',
      port: '',
      user: '',
      password: '',
      database: '',
      tls: false,
      adv: EMPTY_TLS_ADVANCED,
      importUrl: '',
    }
  }
  if (config.url) {
    try {
      const parsed = parseConnectionUrl(config.url, config.dialect)
      return {
        ...parsed,
        ...tlsFields(config.ssl, parsed.tls),
        importUrl: config.url,
      }
    } catch {
      // Preserve an unusual but valid library-specific URL in the import box. The user can
      // correct/re-import it; we never silently invent host values from a failed parse.
      return {
        host: '',
        port: '',
        user: '',
        password: '',
        database: '',
        tls: false,
        adv: EMPTY_TLS_ADVANCED,
        importUrl: config.url,
      }
    }
  }
  const ssl = config.ssl
  const manifest = getDatabaseDriverManifest(config.dialect)
  const tls = ssl !== undefined && ssl !== false
  const defaultPort = tls ? (manifest.defaultTlsPort ?? manifest.defaultPort) : manifest.defaultPort
  return {
    host: config.host ?? '',
    port: config.port != null ? String(config.port) : defaultPort ? String(defaultPort) : '',
    user: config.user ?? '',
    password: config.password ?? '',
    database: config.database ?? '',
    ...tlsFields(ssl),
    importUrl: '',
  }
}

/** Move between protocol defaults without overwriting a port the user chose explicitly. */
export function portAfterTlsToggle(
  dialect: DbDialect,
  currentPort: string,
  enabled: boolean,
): string {
  const manifest = getDatabaseDriverManifest(dialect)
  const plain = manifest.defaultPort
  const secure = manifest.defaultTlsPort ?? plain
  if (!secure || secure === plain) return currentPort
  const priorDefault = enabled ? plain : secure
  if (currentPort && currentPort !== String(priorDefault)) return currentPort
  const nextDefault = enabled ? secure : plain
  return nextDefault ? String(nextDefault) : currentPort
}

export interface BuildConnectionConfigInput {
  dialect: DbDialect
  targetMode: 'file' | 'memory'
  file: string
  host: string
  port: string
  user: string
  password: string
  database: string
  ssl?: DbSslConfig
  ssh?: SshTunnelConfig
  readonly: boolean
  color?: DbConnectionConfig['color']
}

/**
 * The form's single config assembler. It branches only on the manifest transport and
 * emits the public discriminated contract; individual React sections never construct a
 * driver-specific object.
 */
export function buildConnectionConfig(
  input: BuildConnectionConfigInput,
): DbConnectionConfig | null {
  const extras = {
    ...(input.readonly ? { readonly: true } : {}),
    ...(input.color ? { color: input.color } : {}),
  }
  if (isFileDatabaseDialect(input.dialect)) {
    const file = input.targetMode === 'memory' ? ':memory:' : input.file.trim()
    return file ? ({ dialect: input.dialect, file, ...extras } as DbConnectionConfig) : null
  }
  const host = input.host.trim()
  if (!host) return null
  const port = input.port.trim() ? Number(input.port.trim()) : undefined
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) return null
  return {
    dialect: input.dialect,
    host,
    ...(port !== undefined ? { port } : {}),
    ...(input.user.trim() ? { user: input.user.trim() } : {}),
    ...(input.password ? { password: input.password } : {}),
    ...(input.database.trim() ? { database: input.database.trim() } : {}),
    ...(input.ssl !== undefined ? { ssl: input.ssl } : {}),
    ...(input.ssh ? { ssh: input.ssh } : {}),
    ...extras,
  } as DbConnectionConfig
}

export { vaultSecrets } from './vaultSecrets'

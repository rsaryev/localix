import { fileURLToPath } from 'node:url'

/**
 * The database file a `file://` URL names, or null when the value is not a file URL.
 *
 * ONE function for both readers of the URL, because they are a security pair: the permission
 * layer checks the path `databaseCallPaths` reports, and the connection opens the path
 * `buildConnectionConfig` builds. They used two different regex strips (one case-insensitive and
 * trimmed, one neither), so ` FILE:///etc/x.db` was checked as one path and opened as another.
 * A regex strip was also wrong on its own: it kept percent-escapes (`my%20app.db` is not the
 * file `my app.db`) and left a Windows `file:///C:/x.db` as `/C:/x.db`. `fileURLToPath` decodes
 * both as the platform does; a URL it rejects (a host, as in `file://./app.db`) keeps the plain
 * strip, so those relative forms resolve as they always did.
 */
export function fileUrlPath(url: string): string | null {
  const s = url.trim()
  if (!/^file:\/\//i.test(s)) return null
  try {
    return fileURLToPath(s)
  } catch {
    return s.replace(/^file:\/\//i, '')
  }
}

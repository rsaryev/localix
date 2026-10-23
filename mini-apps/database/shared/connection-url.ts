const URL_SCHEME_RE = /^[a-zA-Z][\w+.-]*:\/\//

export interface ConnectionUrlPassword {
  /** Everything through the username, excluding the password separator. */
  head: string
  /** Password spelling exactly as supplied (encoded URL bytes stay encoded). */
  password: string
  /** Host authority and the rest of the URL, excluding the userinfo separator. */
  tail: string
}

/**
 * Split a database URL around its password without requiring WHATWG compatibility.
 * MongoDB multi-host URLs are intentionally accepted. The final `@` in authority is the
 * host separator; earlier unescaped `@` characters belong to userinfo and are therefore
 * part of the password, matching WHATWG normalization.
 */
export function splitConnectionUrlPassword(url: string): ConnectionUrlPassword | null {
  const trimmed = url.trim()
  const scheme = URL_SCHEME_RE.exec(trimmed)
  if (!scheme) return null
  const authorityStart = scheme[0].length
  const suffixOffset = trimmed.slice(authorityStart).search(/[/?#]/)
  const authorityEnd = suffixOffset < 0 ? trimmed.length : authorityStart + suffixOffset
  const authority = trimmed.slice(authorityStart, authorityEnd)
  const hostSeparator = authority.lastIndexOf('@')
  if (hostSeparator < 0) return null
  const userInfo = authority.slice(0, hostSeparator)
  const passwordSeparator = userInfo.indexOf(':')
  if (passwordSeparator < 0) return null
  return {
    head: `${trimmed.slice(0, authorityStart)}${userInfo.slice(0, passwordSeparator)}`,
    password: userInfo.slice(passwordSeparator + 1),
    tail: `${authority.slice(hostSeparator + 1)}${trimmed.slice(authorityEnd)}`,
  }
}

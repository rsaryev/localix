/** Pure helpers for SQL Server's semicolon-delimited ADO connection-string form. Values may
 * quote or brace semicolons, so regex splitting can leak a password or invent a Server field
 * from credential text. */

const SERVER_KEYS = new Set(['server', 'data source', 'address', 'addr', 'network address'])

function scanAdo(connectionString: string): { segments: string[]; complete: boolean } {
  const segments: string[] = []
  let start = 0
  let quote: '"' | "'" | undefined
  let braced = false

  for (let index = 0; index < connectionString.length; index++) {
    const char = connectionString[index]
    if (braced) {
      if (char === '}' && connectionString[index + 1] === '}') index++
      else if (char === '}') braced = false
      continue
    }
    if (quote) {
      if (char === quote && connectionString[index + 1] === quote) index++
      else if (char === quote) quote = undefined
      continue
    }
    if (char === '{') braced = true
    else if (char === '"' || char === "'") quote = char
    else if (char === ';') {
      segments.push(connectionString.slice(start, index))
      start = index + 1
    }
  }
  segments.push(connectionString.slice(start))
  return { segments, complete: !quote && !braced }
}

function adoProperty(segment: string): { key: string; value: string } | null {
  const equals = segment.indexOf('=')
  if (equals < 0) return null
  return {
    key: segment.slice(0, equals).trim().replace(/\s+/g, ' ').toLowerCase(),
    value: segment.slice(equals + 1).trim(),
  }
}

/** Whether a non-URI string has a top-level, non-empty SQL Server endpoint property. */
export function isMssqlAdoConnectionString(connectionString: string): boolean {
  const { segments, complete } = scanAdo(connectionString)
  return (
    complete &&
    segments.some((segment) => {
      const property = adoProperty(segment)
      return property !== null && SERVER_KEYS.has(property.key) && !!property.value
    })
  )
}

/** Stable ADO target identity with Password/Pwd properties removed in full. */
export function mssqlAdoTarget(connectionString: string): string {
  return scanAdo(connectionString)
    .segments.filter((segment) => {
      const property = adoProperty(segment)
      return property === null || (property.key !== 'password' && property.key !== 'pwd')
    })
    .join(';')
    .trim()
}

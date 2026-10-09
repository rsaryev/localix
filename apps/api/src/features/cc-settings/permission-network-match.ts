import type { CcRuleCall } from './permission-rules'
import { specifierIsAll } from './permission-value-match'

function matchDomain(pattern: string, host: string): boolean {
  const p = pattern.trim().toLowerCase()
  const h = host.trim().toLowerCase()
  if (p === '' || p === '*') return true
  if (p.startsWith('*.')) return h.endsWith('.' + p.slice(2)) // any subdomain depth, apex excluded
  // Non-leading `*` matches only within a label.
  try {
    const src = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\\?\*/g, '[^.]*')
    return new RegExp(`^${src}$`).test(h)
  } catch {
    return h === p
  }
}

function callHosts(input: Record<string, unknown>): string[] {
  const values = [
    ...(typeof input.url === 'string' ? [input.url] : []),
    ...(Array.isArray(input.urls)
      ? input.urls.filter((url): url is string => typeof url === 'string')
      : []),
  ]
  const hosts: string[] = []
  for (const value of values) {
    try {
      hosts.push(new URL(value).hostname)
    } catch {
      // Invalid URLs are rejected by research itself; they cannot match a domain rule.
    }
  }
  for (const domain of Array.isArray(input.include_domains) ? input.include_domains : []) {
    if (typeof domain !== 'string' || !domain.trim()) continue
    try {
      hosts.push(new URL(domain.includes('://') ? domain : `https://${domain}`).hostname)
    } catch {
      // Invalid domain filters are rejected by the tool schema.
    }
  }
  return hosts
}

export function matchWebFetch(specifier: string | undefined, call: CcRuleCall): boolean {
  if (specifierIsAll(specifier)) return true
  // Keep this authority check tool-agnostic: built-in research, plugins, and
  // MCP tools can all load URLs and must all obey an imported WebFetch rule.
  const hosts = callHosts(call.input)
  if (hosts.length === 0) return false
  const spec = specifier!.trim()
  const domain = spec.startsWith('domain:') ? spec.slice('domain:'.length) : spec
  return hosts.some((host) => matchDomain(domain, host))
}

/** Normalize an MCP rule prefix to the engine's `mcp_server_tool` form. */
function normalizeMcpPrefix(s: string): string {
  return s.replace(/__+/g, '_').replace(/[^a-zA-Z0-9_]/g, '_')
}

export function matchMcp(ruleTool: string, engineName: string): boolean {
  if (!engineName.startsWith('mcp_')) return false
  if (ruleTool === 'mcp__*') return true
  const starIdx = ruleTool.indexOf('*')
  if (starIdx >= 0) {
    const prefix = normalizeMcpPrefix(ruleTool.slice(0, starIdx))
    return engineName.startsWith(prefix)
  }
  const parts = ruleTool.split('__').filter((p) => p.length > 0) // ['mcp','server'] | ['mcp','server','tool']
  const normalized = normalizeMcpPrefix(ruleTool)
  if (parts.length <= 2) {
    // server-only → every tool of that server
    return engineName === normalized || engineName.startsWith(normalized + '_')
  }
  return engineName === normalized
}

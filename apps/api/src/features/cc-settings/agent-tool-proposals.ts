import type { Rule } from '../capabilities/rule'
import type { FormatDiagnostic } from '../ext/format-adapter'
import { CC_SEMANTIC_GAPS, CC_TOOL_NAME_MAP, normalizeMcpToolAlias } from '../ext/cc-tool-names'
import { splitTokenList } from '../agent-core/skill-frontmatter'
import { parseRuleString } from './permission-rules'

/** Translate declarations into inert native proposals; never discard an unknown restriction. */
export function agentToolProposals(
  fields: Record<string, unknown>,
  diagnostics: FormatDiagnostic[],
): Rule[] {
  const rules: Rule[] = []
  for (const field of ['tools', 'disallowedTools'] as const) {
    const raw = fields[field]
    if (raw === undefined) continue
    const report = (status: 'invalid' | 'unsupported', message: string) =>
      diagnostics.push({ field, status, impact: 'authority', message })
    if (
      !(typeof raw === 'string' && raw.trim()) &&
      !(Array.isArray(raw) && raw.every((item) => typeof item === 'string' && item.trim()))
    ) {
      report('invalid', 'Expected a tool list')
      continue
    }
    const tokens = splitTokenList(raw as string | string[]) ?? []
    const effect: Rule['effect'] = field === 'tools' ? 'allow' : 'deny'
    if (field === 'tools') rules.push({ action: 'tool:*', resource: '*', effect: 'deny' })
    for (const token of tokens) {
      if (token === '*') {
        rules.push({ action: 'tool:*', resource: '*', effect })
        continue
      }
      const parsed = parseRuleString(token)
      const name = parsed?.tool.toLowerCase() ?? ''
      const tool =
        parsed &&
        ((/^mcp__.+__.+$/.test(parsed.tool) ? normalizeMcpToolAlias(parsed.tool) : undefined) ??
          (Object.hasOwn(CC_TOOL_NAME_MAP, name) ? CC_TOOL_NAME_MAP[name] : undefined))
      if (!tool || CC_SEMANTIC_GAPS[name]) {
        report('unsupported', 'Tool has no semantics-preserving translation')
        continue
      }
      let resources = ['*']
      if (parsed?.specifier !== undefined) {
        const specifier = parsed.specifier.trim()
        // Filesystem roots and richer external glob grammars require contextual translation.
        // Reject them until that translation exists rather than broadening to the whole tool.
        if (tool !== 'bash' || !specifier || !/^[\w\s./:*=+-]+$/.test(specifier)) {
          report('unsupported', 'Argument restriction requires contextual translation')
          continue
        }
        resources = specifier.endsWith(':*')
          ? [specifier.slice(0, -2), `${specifier.slice(0, -2)} *`]
          : [specifier]
      }
      rules.push(...resources.map((resource) => ({ action: `tool:${tool}`, resource, effect })))
    }
    diagnostics.push({
      field,
      status: 'translated',
      impact: 'authority',
      message: 'Tool declarations translated to separate policy proposals',
    })
  }
  return rules
}

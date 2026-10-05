import type { FormatAdapter, FormatDiagnostic } from '../ext/format-adapter'
import { createFormatAdapterRegistry } from '../ext/format-adapter'
import { agentContributionSchema } from '../agents/contribution'
import { parseYamlFrontmatterBlock, splitFrontmatter } from '../agent-core/frontmatter-yaml'
import { splitTokenList } from '../agent-core/skill-frontmatter'
import { agentToolProposals } from './agent-tool-proposals'
import { isReasoningEffort } from '@localixai/agent'

const BEHAVIOR_FIELDS = new Set([
  'name',
  'description',
  'when-to-use',
  'when_to_use',
  'model',
  'effort',
  'skills',
  'maxTurns',
  'max_turns',
  'memory',
])

/** A format boundary, not a runtime profile: no external fields enter the native definition. */
export const claudeCodeAgentFormat: FormatAdapter = {
  format: 'claude-code.agent-markdown',
  version: 1,
  decode(text) {
    const block = splitFrontmatter(text)
    const fields = parseYamlFrontmatterBlock(text)
    const diagnostics: FormatDiagnostic[] = []
    if (!block || !fields) {
      return {
        value: null,
        diagnostics: [
          {
            field: '',
            status: 'invalid',
            impact: 'execution',
            message: 'Expected valid YAML agent frontmatter',
          },
        ],
      }
    }
    for (const field of Object.keys(fields)) {
      if (BEHAVIOR_FIELDS.has(field) || field === 'tools' || field === 'disallowedTools') continue
      // Unknown fields may carry constraints. Only a known presentation field is non-blocking.
      diagnostics.push({
        field,
        status: 'unsupported',
        impact: field === 'color' ? 'presentation' : 'authority',
        message: 'This field has no native contribution translator yet',
      })
    }
    const strings = (field: string): string | undefined => {
      const value = fields[field]
      if (value === undefined) return undefined
      if (
        typeof value === 'string' &&
        (value.trim() ||
          field === 'description' ||
          field === 'when-to-use' ||
          field === 'when_to_use')
      )
        return value
      diagnostics.push({
        field,
        status: 'invalid',
        impact: 'execution',
        message: 'Expected a string',
      })
      return undefined
    }
    let preloadSkills: string[] | undefined
    if (fields.skills !== undefined) {
      if (
        typeof fields.skills === 'string' ||
        (Array.isArray(fields.skills) && fields.skills.every((skill) => typeof skill === 'string'))
      ) {
        preloadSkills = splitTokenList(fields.skills) ?? []
      } else
        diagnostics.push({
          field: 'skills',
          status: 'invalid',
          impact: 'execution',
          message: 'Expected skill names',
        })
    }
    const memory = strings('memory')
    if (memory && memory !== 'user' && memory !== 'project') {
      diagnostics.push({
        field: 'memory',
        status: 'unsupported',
        impact: 'execution',
        message: 'Memory scope requires a context translator',
      })
    }
    const model = strings('model')
    const effort = strings('effort')
    if (model && ['opus', 'sonnet', 'haiku'].includes(model.toLowerCase())) {
      diagnostics.push({
        field: 'model',
        status: 'unsupported',
        impact: 'execution',
        message:
          'This external model alias is not a native catalog model. Choose an explicit provider/model before importing.',
      })
    }
    if (effort && !isReasoningEffort(effort)) {
      diagnostics.push({
        field: 'effort',
        status: 'invalid',
        impact: 'execution',
        message: 'Unknown reasoning effort',
      })
    }
    const rawMaxTurns = fields.maxTurns !== undefined ? fields.maxTurns : fields.max_turns
    const maxTurns =
      typeof rawMaxTurns === 'string' && /^\d+$/.test(rawMaxTurns)
        ? Number(rawMaxTurns)
        : rawMaxTurns
    const handle = strings('name')
    const description = [strings('description'), strings('when-to-use'), strings('when_to_use')]
      .filter(Boolean)
      .join(' ')
      .trim()
    const policyProposals = agentToolProposals(fields, diagnostics)
    for (const field of Object.keys(fields).filter((key) => BEHAVIOR_FIELDS.has(key))) {
      if (!diagnostics.some((item) => item.field === field))
        diagnostics.push({
          field,
          status: 'translated',
          impact: 'execution',
          message: 'Translated to native authored behavior',
        })
    }
    return {
      value: {
        definition: {
          handle,
          description,
          instructions: block.body,
          ...((model && model !== 'inherit') || effort
            ? {
                modelPreference: {
                  ...(model && model !== 'inherit' ? { model } : {}),
                  ...(effort ? { effort } : {}),
                },
              }
            : {}),
          ...(maxTurns !== undefined ? { limits: { maxTurns } } : {}),
          ...(preloadSkills || memory
            ? {
                context: {
                  ...(preloadSkills ? { preloadSkills } : {}),
                  ...(memory === 'user' || memory === 'project'
                    ? { memory: { scope: memory === 'user' ? 'global' : 'project' } }
                    : {}),
                },
              }
            : {}),
        },
        policyProposals,
      },
      diagnostics,
    }
  },
}

const formats = createFormatAdapterRegistry(agentContributionSchema)
formats.register(claudeCodeAgentFormat)

export const decodeClaudeCodeAgent = (text: string, source: string) =>
  formats.decode({
    source,
    text,
    format: claudeCodeAgentFormat.format,
    version: claudeCodeAgentFormat.version,
  })

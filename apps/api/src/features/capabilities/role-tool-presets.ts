import { TOOL, BUILTIN_TOOL_NAMES } from '../agent-core/tool-names'
import type { Rule } from './rule'

const SHARED = [
  TOOL.ask,
  TOOL.context_budget,
  TOOL.read,
  TOOL.search,
  TOOL.tool_output,
  TOOL.memory,
  TOOL.history_search,
  TOOL.skill,
  TOOL.agents,
  TOOL.conversation_control,
  TOOL.configure,
  TOOL.plan,
  TOOL.research,
  TOOL.mcp_resources,
]
const FILES = [TOOL.write, TOOL.edit, TOOL.apply_patch]
const ENGINEERING = [...SHARED, ...FILES, TOOL.bash, TOOL.jobs]
const VISUAL = [TOOL.browser, TOOL.view_image]

export const ROLE_TOOL_PRESETS: Readonly<Record<string, readonly string[]>> = {
  lead: [...ENGINEERING, ...VISUAL, TOOL.vault],
  pm: [...SHARED, ...FILES, TOOL.bash, ...VISUAL],
  architect: [...SHARED, ...FILES, TOOL.bash, ...VISUAL],
  backend: [...ENGINEERING, TOOL.vault],
  frontend: [...ENGINEERING, ...VISUAL],
  qa: [...ENGINEERING, ...VISUAL],
  design: [...SHARED, ...FILES, TOOL.bash, ...VISUAL],
  devops: [...ENGINEERING, TOOL.vault],
}

/** The pre-audit v10 roster is known, so untouched installations can migrate safely. */
export const LEGACY_ROLE_TOOL_PRESETS = Object.fromEntries(
  Object.keys(ROLE_TOOL_PRESETS).map((handle) => [handle, BUILTIN_TOOL_NAMES]),
)

export function roleArtifactRules(handle: string): Rule[] {
  const classes: Readonly<Record<string, readonly string[]>> = {
    pm: ['documentation-files'],
    architect: ['documentation-files', 'prototype-files'],
    qa: ['test-files', 'documentation-files'],
    design: ['prototype-files', 'documentation-files'],
  }
  const artifacts = classes[handle]
  return artifacts
    ? FILES.flatMap((tool) => [
        { action: `tool:${tool}`, resource: 'effect:files', effect: 'deny' as const },
        ...artifacts.map((resource) => ({
          action: `tool:${tool}`,
          resource,
          effect: 'allow' as const,
        })),
      ])
    : []
}

/** Multipurpose inspection tools must not bypass the PM's scope through a shell or clicks. */
export function roleCallRules(handle: string): Rule[] {
  if (handle !== 'pm') return []
  return [
    { action: 'tool:bash', resource: 'effect:external', effect: 'deny' },
    { action: 'tool:browser', resource: 'effect:external', effect: 'deny' },
    { action: 'tool:browser', resource: 'effect:host', effect: 'deny' },
  ]
}

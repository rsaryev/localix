import type { SessionRecord } from './repository-types'
import { serializeSessionProvenance } from './session-provenance'

export function sessionRowPatch(patch: Partial<SessionRecord>) {
  return {
    ...(patch.externalAgentProvider !== undefined
      ? { external_agent_provider: patch.externalAgentProvider }
      : {}),
    ...(patch.externalAgentSessionKey !== undefined
      ? { external_agent_session_key: patch.externalAgentSessionKey }
      : {}),
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.goal !== undefined ? { goal: patch.goal } : {}),
    ...(patch.previousTopicSummary !== undefined
      ? { previous_topic_summary: patch.previousTopicSummary }
      : {}),
    ...(patch.isPinned !== undefined ? { is_pinned: patch.isPinned ? 1 : 0 } : {}),
    ...(patch.projectId !== undefined ? { project_id: patch.projectId } : {}),
    ...(patch.parentSessionId !== undefined ? { parent_session_id: patch.parentSessionId } : {}),
    ...(patch.rootSessionId !== undefined ? { root_session_id: patch.rootSessionId } : {}),
    ...(patch.sessionKind !== undefined ? { session_kind: patch.sessionKind } : {}),
    ...(patch.runtimeStatus !== undefined ? { runtime_status: patch.runtimeStatus } : {}),
    ...(patch.sourceToolCallId !== undefined
      ? { source_tool_call_id: patch.sourceToolCallId }
      : {}),
    ...(patch.provenance !== undefined
      ? { invocation_json: serializeSessionProvenance(patch.provenance) }
      : {}),
    ...(patch.pinnedSkills !== undefined
      ? { pinned_skills: JSON.stringify(patch.pinnedSkills) }
      : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.activatedTools !== undefined
      ? {
          activated_tools: patch.activatedTools.length
            ? JSON.stringify(patch.activatedTools)
            : null,
        }
      : {}),
    ...(patch.archivedAt !== undefined ? { archived_at: patch.archivedAt } : {}),
    ...(patch.closedAt !== undefined ? { closed_at: patch.closedAt } : {}),
    ...(patch.permissionMode !== undefined ? { permission_mode: patch.permissionMode } : {}),
    ...(patch.outputStyle !== undefined ? { output_style: patch.outputStyle } : {}),
    ...(patch.updatedAt !== undefined ? { updated_at: patch.updatedAt } : {}),
    ...(patch.lastMessageAt !== undefined ? { last_message_at: patch.lastMessageAt } : {}),
  }
}

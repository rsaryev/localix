/**
 * The VOLATILE half of the prompt catalog (`catalog.ts`): the turn's runtime context, in order.
 * Each section is keyed by its id, so a turn re-sends only the `state` sections that changed and
 * carries `turn` sections for that turn alone.
 */
import { TOOL } from '../tool-names'
import type { PromptSection } from './section'
import { buildBackgroundJobsSection } from './sections/background-jobs'
import { buildAgentDirectorySection, buildParticipantsSection } from './sections/conversation'
import {
  buildActiveSubAgentsSection,
  buildLoopsSection,
  buildMcpInstructionsSection,
  buildMcpInventorySection,
  buildScratchSection,
  buildTriggeredSkillsSection,
} from './sections/features'
import { buildProjectStructureSection, formatRuntimeContext } from './sections/workspace'

const nonEmpty = <T>(list: readonly T[] | undefined): list is readonly T[] =>
  (list?.length ?? 0) > 0

export const TAIL_SECTIONS: readonly PromptSection[] = [
  // The marker itself, and everything after it: state that moves under the agent's own feet.
  {
    id: 'runtime',
    tier: 'state',
    heading: '# Runtime context',
    render: (f) => formatRuntimeContext(f.params),
  },
  {
    // A fresh shallow tree, re-read every run: the agent itself changes it.
    id: 'project-structure',
    tier: 'state',
    heading: '# Project structure',
    render: (f) => buildProjectStructureSection(f.params.projectStructure),
  },
  {
    // Which servers are connected RIGHT NOW, including ones still connecting — it changes
    // without anything in the conversation changing.
    id: 'mcp-inventory',
    tier: 'state',
    heading: '# MCP servers',
    render: (f) =>
      nonEmpty(f.params.mcpInventory) ? buildMcpInventorySection([...f.params.mcpInventory]) : null,
  },
  {
    id: 'mcp-instructions',
    tier: 'state',
    heading: '# MCP server instructions',
    render: (f) =>
      nonEmpty(f.params.mcpInstructions)
        ? buildMcpInstructionsSection([...f.params.mcpInstructions])
        : null,
  },
  {
    // Marks placed since this agent last spoke — per turn by definition.
    id: 'reactions',
    tier: 'turn',
    heading: '# Reactions since your last turn',
    render: (f) => f.params.reactionContext,
  },
  {
    // WHO is in the conversation. Agents invite and remove each other mid-conversation; above
    // the boundary every such change rewrote the cached prefix of every participant.
    id: 'participants',
    tier: 'state',
    heading: '# Conversation participants',
    render: (f) =>
      f.params.conversation && !f.params.conversation.isolated
        ? buildParticipantsSection(f.params.conversation)
        : null,
  },
  {
    // The directory is who a tag can reach. A rule edit or a colleague joining changes a row,
    // with no turn boundary.
    id: 'agent-directory',
    tier: 'state',
    heading: '# Agent directory',
    render: (f) =>
      nonEmpty(f.params.agentDirectory)
        ? buildAgentDirectorySection(f.params.agentDirectory)
        : null,
  },
  {
    // The trigger is THIS turn's user message, so the content comes and goes with it.
    id: 'triggered-skills',
    tier: 'turn',
    heading: '# Triggered skills',
    render: (f) =>
      nonEmpty(f.params.triggeredSkills)
        ? buildTriggeredSkillsSection([...f.params.triggeredSkills])
        : null,
  },
  {
    id: 'scratch',
    tier: 'state',
    heading: '# Scratch space',
    render: (f) => (f.params.scratchDir ? buildScratchSection(f.params.scratchDir) : null),
  },
  {
    id: 'sub-agents',
    tier: 'state',
    heading: '# Active sub-agents',
    render: (f) =>
      nonEmpty(f.params.activeSubAgents)
        ? buildActiveSubAgentsSection([...f.params.activeSubAgents], {
            canInspectHistory: f.hasTool(TOOL.global_search),
            canListRuns: f.hasTool(TOOL.delegate),
          })
        : null,
  },
  {
    id: 'loops',
    tier: 'state',
    heading: '# Loops',
    render: (f) =>
      f.params.loopContext && f.params.loopContext.loops.length > 0
        ? buildLoopsSection(f.params.loopContext.loops, { canManage: f.hasTool(TOOL.loops) })
        : null,
  },
  {
    id: 'background-jobs',
    tier: 'state',
    heading: '# Background jobs',
    render: (f) =>
      nonEmpty(f.params.backgroundJobs)
        ? buildBackgroundJobsSection([...f.params.backgroundJobs], {
            canManage: f.hasTool(TOOL.jobs),
          })
        : null,
  },
]

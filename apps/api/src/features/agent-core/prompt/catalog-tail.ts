/**
 * The VOLATILE half of the prompt catalog (`catalog.ts`): the turn's runtime context, in order.
 * Each section is keyed by its id, so a turn re-sends only the `state` sections that changed and
 * carries `turn` sections for that turn alone.
 */
import { buildSessionTopicSection } from '../session-topic'
import { TOOL } from '../tool-names'
import type { PromptSection } from './section'
import { buildBackgroundJobsSection } from './sections/background-jobs'
import { buildAgentDirectorySection } from './sections/conversation'
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
    // One session's own: its title, goal and the summary of the topic before it. Above the boundary
    // it made every session's system prompt differ from the next one's, and a new goal rewrote the
    // prompt and with it the whole history that follows. Here a change is one appended block, and
    // every agent of the conversation reads it from its own context.
    id: 'session-objective',
    tier: 'state',
    heading: '# Session objective',
    render: (f) => (f.params.sessionTopic ? buildSessionTopicSection(f.params.sessionTopic) : null),
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
    // The agents `Agent` can start. A rule edit changes a row, with no turn boundary.
    id: 'agent-directory',
    tier: 'state',
    heading: '# Agent directory',
    render: (f) =>
      nonEmpty(f.params.agentDirectory)
        ? buildAgentDirectorySection(f.params.agentDirectory, {
            canDelegate: f.hasTool(TOOL.Agent),
          })
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
            canInspectHistory: f.hasTool(TOOL.GlobalSearch),
            canMessage: f.hasTool(TOOL.Agent),
          })
        : null,
  },
  {
    id: 'loops',
    tier: 'state',
    heading: '# Loops',
    render: (f) =>
      f.params.loopContext && f.params.loopContext.loops.length > 0
        ? buildLoopsSection(f.params.loopContext.loops, { canManage: f.hasTool(TOOL.Loops) })
        : null,
  },
  {
    id: 'background-jobs',
    tier: 'state',
    heading: '# Background jobs',
    render: (f) =>
      nonEmpty(f.params.backgroundJobs)
        ? buildBackgroundJobsSection([...f.params.backgroundJobs], {
            canManage: f.hasTool(TOOL.Jobs),
          })
        : null,
  },
]

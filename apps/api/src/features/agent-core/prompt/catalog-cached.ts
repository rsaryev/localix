/**
 * The CACHED half of the prompt catalog (`catalog.ts`): every section of the system prompt, in
 * order. Each declares `tier: 'stable'` with the reason it never changes mid-turn.
 */
import { ACTIVATE_TOOLS_TOOL_NAME, TOOL } from '../tool-names'
import { buildProjectContextSection } from '../context-files'
import { buildSessionTopicSection } from '../session-topic'
import type { PromptSection } from './section'
import { TASK_BOARD_TOOL } from './facts'
import { RUNTIME_CONTEXT_PROTOCOL } from './runtime-sections'
import { ANSWER_FORMS_PRINCIPLE, buildAnswerFormatSection } from './sections/answer-format'
import { buildCollaborationSection } from './sections/collaboration'
import { buildOutputStyleSection } from './sections/output-style'
import { buildTurnControlSection } from './sections/conversation'
import { buildCorePrinciples, buildExecutionDiscipline } from './sections/discipline'
import {
  buildChannelSection,
  buildPinnedSkillsSection,
  buildPluginsSection,
  buildMiniAppsSection,
  buildSkillsSection,
} from './sections/features'
import { buildApprovedPlanSection, buildPlanModeSection } from './sections/plan'
import { buildRoleSection } from './sections/role'
import { buildSelfSection } from './sections/self'
import { buildWithheldToolsSection } from './sections/withheld'
import {
  buildMemoryContextSection,
  buildProjectInstructionsSection,
  buildWorkspaceSection,
} from './sections/workspace'

const nonEmpty = <T>(list: readonly T[] | undefined): list is readonly T[] =>
  (list?.length ?? 0) > 0

export const CACHED_SECTIONS: readonly PromptSection[] = [
  // Identity and standing instruction — byte-identical for the life of a deployment.
  //
  // WHO this run is arrives ONE way: on the profile, put there by `resolveRunProfile` from the
  // agent record the host dispatched with. Empty means no host passed an agent, which is a host
  // bug rather than a state to paper over: an agent's system prompt is required.
  { id: 'identity', tier: 'stable', render: (f) => f.profile.prompt.identity.trim() },
  {
    id: 'principles',
    tier: 'stable',
    heading: '# Core principles',
    // Where the transcript renders the answer forms, using them is a principle, not a reference
    // the model may skip (`ANSWER_FORMS_PRINCIPLE` names the session that showed it skipping).
    render: (f) =>
      f.rendersAnswers
        ? `${buildCorePrinciples()}\n${ANSWER_FORMS_PRINCIPLE}`
        : buildCorePrinciples(),
  },
  {
    id: 'role',
    tier: 'stable',
    heading: '# Runtime role',
    render: (f) => buildRoleSection(f.profile, f.registry.toolNames),
  },
  {
    // Who does the work sits beside the role that frames it, before the per-tool discipline.
    // Gated on the roster and the room: who may do the work changes when they do, never mid-turn.
    id: 'collaboration',
    tier: 'stable',
    heading: '# Collaboration',
    render: (f) =>
      buildCollaborationSection(f.registry.toolNames, {
        withColleagues: f.room.withColleagues,
        inConversation: f.room.inConversation,
        membershipClosed: !f.room.canInvite,
        isLeader: f.room.isLeader,
      }),
  },
  {
    id: 'discipline',
    tier: 'stable',
    heading: '# Execution discipline',
    // An output style without `keep-coding-instructions` leaves out the software-engineering lines,
    // as Claude Code leaves out its own; the tool routing stays.
    render: (f) =>
      buildExecutionDiscipline(f.registry.toolNames, f.profile, {
        codingInstructions: f.params.outputStyle?.keepCodingInstructions ?? true,
      }),
  },
  {
    id: 'tools',
    tier: 'stable',
    heading: '# Available tools',
    render: (f) => f.registry.promptSection,
  },
  {
    // The host application and its source: fixed for the life of a deployment.
    id: 'self',
    tier: 'stable',
    heading: '# About Localix',
    render: () => buildSelfSection(),
  },
  // Workspace and project. Fixed per project, and shared by every session in it.
  {
    id: 'workspace',
    tier: 'stable',
    heading: '# Workspace',
    render: ({ params, registry }) =>
      params.workspaceRoot
        ? buildWorkspaceSection(
            params.workspaceRoot,
            params.agentProfile,
            registry.toolNames,
            params.workspaceIsGitRepo,
          )
        : null,
  },
  {
    // Session-stable: context files change only when the workspace files change, never
    // mid-session — so they sit right after "# Workspace".
    id: 'project-context',
    tier: 'stable',
    heading: '# Project context',
    render: (f) => buildProjectContextSection(f.params.contextFiles),
  },
  {
    id: 'project-instructions',
    tier: 'stable',
    heading: '# Project instructions',
    render: (f) => buildProjectInstructionsSection(f.params.projectInstructions),
  },
  // The conversation's plan: the mode's instruction (it holds for the whole run) and the plan the
  // person approved (it changes when they decide, never mid-turn).
  {
    id: 'plan-mode',
    tier: 'stable',
    heading: '# Plan mode',
    render: (f) => buildPlanModeSection(f.hasTool, f.params.planMode),
  },
  {
    id: 'approved-plan',
    tier: 'stable',
    heading: '# Approved plan',
    render: (f) => buildApprovedPlanSection(f.params.approvedPlan, f.hasTool),
  },
  {
    // Where this conversation comes from, for sessions driven by an external messaging channel:
    // the reply is relayed back automatically, so the model must not reach for a send tool.
    id: 'channel',
    tier: 'stable',
    heading: '# Channel',
    render: (f) =>
      f.params.deliveryContext?.channel
        ? buildChannelSection(f.params.deliveryContext.channel)
        : null,
  },
  {
    // How a turn in this conversation is run. The RULES are prefix-stable: they change when the
    // conversation goes from one agent to several, or its leader changes — not when a colleague
    // is invited or leaves (that is the roster, in the tail).
    id: 'turn-control',
    tier: 'stable',
    heading: '# Conversation turn control',
    render: (f) =>
      f.room.inConversation
        ? buildTurnControlSection({
            multi: f.room.withColleagues,
            isLeader: f.room.isLeader,
            canChangeTopic: f.room.canChangeTopic,
            canSkip: f.hasTool(TOOL.skip_answer),
            canInvite: f.room.canInvite,
            hasBoard: f.hasTool(TASK_BOARD_TOOL),
            canAsk: f.hasTool(TOOL.ask),
          })
        : null,
  },
  // Capability catalogs. These change when the deployment changes — installing a plugin, adding
  // a skill — not while a turn runs.
  {
    // Only a run holding `skill` can retrieve one; listing skills elsewhere is bloat and a desync.
    id: 'skills',
    tier: 'stable',
    heading: '# Available skills',
    render: (f) =>
      f.params.skillsContext && f.hasTool(TOOL.skill)
        ? buildSkillsSection(f.params.skillsContext)
        : null,
  },
  {
    // Inline content, usable without the `skill` tool, so it rides every run that pinned it.
    id: 'pinned-skills',
    tier: 'stable',
    heading: '# Active skills (applied to this session)',
    render: (f) =>
      nonEmpty(f.params.pinnedSkills) ? buildPinnedSkillsSection([...f.params.pinnedSkills]) : null,
  },
  {
    id: 'plugins',
    tier: 'stable',
    heading: '# Plugins',
    render: (f) => (f.params.pluginsContext ? buildPluginsSection(f.params.pluginsContext) : null),
  },
  {
    id: 'mini-apps',
    tier: 'stable',
    heading: '# Mini apps',
    render: (f) =>
      f.params.miniAppsContext
        ? buildMiniAppsSection(f.params.miniAppsContext, f.hasTool(ACTIVATE_TOOLS_TOOL_NAME))
        : null,
  },
  {
    // The ledger's remediable withholds, addressed to `configure`: a rule change moves them, a
    // turn never does.
    id: 'withheld',
    tier: 'stable',
    heading: '# Unavailable tools',
    render: (f) =>
      buildWithheldToolsSection(
        f.registry.ledger,
        f.registry.toolNames,
        f.params.awaitingConsentPlugins ?? [],
        f.params.awaitingConsentMiniApps ?? [],
      ),
  },
  {
    // How the transcript renders an answer: fixed by the shape and the delivery, never per turn.
    // Placed before the memory, whose style preferences the section defers to.
    id: 'answer-format',
    tier: 'stable',
    heading: '# Answer formatting',
    render: (f) => (f.rendersAnswers ? buildAnswerFormatSection() : null),
  },
  {
    // The person picks a style between turns (`/output-style`), so it closes the formatting rules
    // and leaves the prefix above it — tools, workspace, skills — cached when it changes.
    id: 'output-style',
    tier: 'stable',
    heading: '# Output style',
    render: (f) => (f.params.outputStyle ? buildOutputStyleSection(f.params.outputStyle) : null),
  },
  {
    // Persistent memory belongs in the stable prefix.
    id: 'memory',
    tier: 'stable',
    heading: '# Memory context',
    render: (f) =>
      f.params.memoryContext
        ? buildMemoryContextSection(f.params.memoryContext, f.params.memoryUsage)
        : null,
  },
  {
    // How to read the `<runtime-context>` rows the history carries — fixed text, never per turn.
    id: 'context-protocol',
    tier: 'stable',
    heading: '# Context protocol',
    render: () => RUNTIME_CONTEXT_PROTOCOL,
  },
  {
    // The session objective changes only when the topic owner sets a new one, so it closes the
    // cached prefix: a topic change rewrites the least of it. Never frozen in a memory snapshot.
    id: 'session-objective',
    tier: 'stable',
    heading: '# Session objective',
    render: (f) => (f.params.sessionTopic ? buildSessionTopicSection(f.params.sessionTopic) : null),
  },
]

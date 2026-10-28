/**
 * The sections of a run that depend on what the run IS: its role, its tools, its workspace, its
 * mode, its skills and plugins. They are `state` sections, carried in the conversation's runtime
 * context and not in the system prompt, so the system prompt is the same for every kind of run
 * (`catalog-cached.ts`; `system-prompt-one.test.ts` holds that).
 */
import { ACTIVATE_TOOLS_TOOL_NAME, TOOL } from '../tool-names'
import { buildProjectContextSection } from '../context-files'
import type { PromptSection } from './section'
import { TASK_BOARD_TOOL } from './facts'
import { buildAnswerFormatSection } from './sections/answer-format'
import { buildCollaborationSection } from './sections/collaboration'
import { buildOutputStyleSection } from './sections/output-style'
import { buildTurnControlSection } from './sections/conversation'
import { buildExecutionDiscipline } from './sections/discipline'
import {
  buildChannelSection,
  buildPinnedSkillsSection,
  buildPluginsSection,
  buildMiniAppsSection,
  buildSkillsSection,
} from './sections/features'
import { buildApprovedPlanSection, buildPlanModeSection } from './sections/plan'
import { buildRoleSection } from './sections/role'
import { buildWithheldToolsSection } from './sections/withheld'
import { buildMemorySection } from './sections/memory'
import { buildProjectInstructionsSection, buildWorkspaceSection } from './sections/workspace'

const nonEmpty = <T>(list: readonly T[] | undefined): list is readonly T[] =>
  (list?.length ?? 0) > 0

export const RUN_SECTIONS: readonly PromptSection[] = [
  {
    id: 'role',
    tier: 'state',
    heading: '# Runtime role',
    render: (f) => buildRoleSection(f.profile, f.registry.toolNames),
  },
  {
    // Who does the work sits beside the role that frames it, before the per-tool discipline.
    id: 'collaboration',
    tier: 'state',
    heading: '# Collaboration',
    render: (f) => buildCollaborationSection(f.registry.toolNames),
  },
  {
    id: 'discipline',
    tier: 'state',
    heading: '# Execution discipline',
    // An output style without `keep-coding-instructions` leaves out the software-engineering lines,
    // as Claude Code leaves out its own; the tool routing stays.
    render: (f) =>
      buildExecutionDiscipline(f.registry.toolNames, f.profile, {
        codingInstructions: f.params.outputStyle?.keepCodingInstructions ?? true,
      }),
  },
  // Workspace and project. Fixed per project, and shared by every session in it.
  {
    id: 'workspace',
    tier: 'state',
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
    tier: 'state',
    heading: '# Project context',
    render: (f) => buildProjectContextSection(f.params.contextFiles),
  },
  {
    id: 'project-instructions',
    tier: 'state',
    heading: '# Project instructions',
    render: (f) => buildProjectInstructionsSection(f.params.projectInstructions),
  },
  // The conversation's plan: the mode's instruction (it holds for the whole run) and the plan the
  // person approved (it changes when they decide, never mid-turn).
  {
    id: 'plan-mode',
    tier: 'state',
    heading: '# Plan mode',
    render: (f) => buildPlanModeSection(f.hasTool, f.params.planMode),
  },
  {
    id: 'approved-plan',
    tier: 'state',
    heading: '# Approved plan',
    render: (f) => buildApprovedPlanSection(f.params.approvedPlan, f.hasTool),
  },
  {
    // Where this conversation comes from, for sessions driven by an external messaging channel:
    // the reply is relayed back automatically, so the model must not reach for a send tool.
    id: 'channel',
    tier: 'state',
    heading: '# Channel',
    render: (f) =>
      f.params.deliveryContext?.channel
        ? buildChannelSection(f.params.deliveryContext.channel)
        : null,
  },
  {
    // How a turn with the person is run. Prefix-stable: it changes only with the run's tools.
    id: 'turn-control',
    tier: 'state',
    heading: '# Conversation turn control',
    render: (f) =>
      f.params.conversation
        ? buildTurnControlSection({
            hasBoard: f.hasTool(TASK_BOARD_TOOL),
            canAsk: f.hasTool(TOOL.AskUserQuestion),
          })
        : null,
  },
  // Capability catalogs. These change when the deployment changes — installing a plugin, adding
  // a skill — not while a turn runs.
  {
    // Only a run holding `skill` can retrieve one; listing skills elsewhere is bloat and a desync.
    id: 'skills',
    tier: 'state',
    heading: '# Available skills',
    render: (f) =>
      f.params.skillsContext && f.hasTool(TOOL.Skill)
        ? buildSkillsSection(f.params.skillsContext)
        : null,
  },
  {
    // Inline content, usable without the `Skill` tool, so it rides every run that pinned it.
    id: 'pinned-skills',
    tier: 'state',
    heading: '# Active skills (applied to this session)',
    render: (f) =>
      nonEmpty(f.params.pinnedSkills) ? buildPinnedSkillsSection([...f.params.pinnedSkills]) : null,
  },
  {
    id: 'plugins',
    tier: 'state',
    heading: '# Plugins',
    render: (f) => (f.params.pluginsContext ? buildPluginsSection(f.params.pluginsContext) : null),
  },
  {
    id: 'mini-apps',
    tier: 'state',
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
    tier: 'state',
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
    tier: 'state',
    heading: '# Answer formatting',
    render: (f) => (f.rendersAnswers ? buildAnswerFormatSection() : null),
  },
  {
    // The person picks a style between turns (`/output-style`), so it closes the formatting rules
    // and leaves the prefix above it — tools, workspace, skills — cached when it changes.
    id: 'output-style',
    tier: 'state',
    heading: '# Output style',
    render: (f) => (f.params.outputStyle ? buildOutputStyleSection(f.params.outputStyle) : null),
  },
  {
    // Persistent memory belongs in the stable prefix.
    id: 'memory',
    tier: 'state',
    heading: '# Memory',
    render: (f) => (f.params.memory ? buildMemorySection(f.params.memory) : null),
  },
]

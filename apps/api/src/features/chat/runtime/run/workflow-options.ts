import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { ScriptSandbox } from '@localixai/agent/runtime'

import { localixHome } from '../../../../lib/env'
import type { OptionalToolPorts } from '../../../agent-core/tool-registry'
import { isToolDirect, type RunProfile } from '../../../agent-core/run-shape'
import { TOOL } from '../../../agent-core/tool-names'
import { dropExpectedReport } from '../../../agent-core/delegation-awaits'
import {
  startWorkflowAgent,
  type WorkflowAgentDeps,
} from '../../../agent-core/tools/workflow/agent-start'
import {
  workflowAgentRoute,
  workflowConcurrency,
  type ChatModel,
} from '../../../agent-core/tools/workflow/agent-route'
import { createWorkflowRunStore } from '../../../agent-core/tools/workflow/journal'
import type { DelegatePluginPorts } from '../../../agent-core/tools/delegate-plugin-agent'
import { createAgentWorktree } from '../../../agent-core/tools/workflow/worktree'
import {
  adoptHookWorktree,
  type WorktreeHook,
} from '../../../agent-core/tools/workflow/hook-worktree'
import type { WorkflowEntry } from '../../../agent-core/tools/workflow/workflow'
import type { TaskDelegationOptions } from '../../../agent-core/tools/task-delegation'
import type { SessionRecord } from '../../repository'
import { getAgentService } from '../agent-service-binding'

/** A workflow script is far smaller; a larger file is not read. */
const MAX_WORKFLOW_BYTES = 1024 * 1024

export interface WorkflowOptionsInput {
  userId: string
  session: SessionRecord
  agentProfile: RunProfile
  taskDelegation?: TaskDelegationOptions
  scripts?: ScriptSandbox
  /** The enabled plugins' workflows for this run's scope (`plugins/workflow-commands.ts`). */
  listWorkflows?: () => Promise<WorkflowEntry[]>
  /** The chat's model this turn: an agent's `model` resolves against its provider. */
  chatModel?: ChatModel
  /** The model catalog the turn already read. */
  catalog?: readonly { id: string; providerId: string }[]
  /** The chat's folder: an isolated agent works in a worktree of its repository. */
  defaultCwd: string
  /** The run's WorktreeCreate hooks, when it has any: they make the worktree in git's place. */
  worktreeHook?: WorktreeHook
  /** The run's plugin agent types, which an `agentType` names (`plugin-subagent.ts`). */
  pluginAgents?: DelegatePluginPorts
  /** Where the conversations' run journals live; `~/.localix/workflow-runs` by default. */
  runsRoot?: string
}

/** Where one conversation's workflow runs keep their scripts and journals. */
export const workflowRunsRoot = (): string => path.join(localixHome(), 'workflow-runs')

/**
 * Build `workflow` for a chat that can create children and has a workflow command behind it: the
 * command activates the tool for the session, so a chat that never ran one carries no schema for
 * it. Its agents are this chat's children, started the way `delegate` starts them, each run in a
 * pool of lanes of its own at Claude Code's concurrency, on the model, effort and folder the
 * script asks for; the runs journal into the conversation's folder, so a stopped one resumes.
 */
export function buildWorkflowOptions(input: WorkflowOptionsInput): OptionalToolPorts['workflow'] {
  const { userId, session, agentProfile, taskDelegation, scripts, listWorkflows } = input
  if (!scripts || !taskDelegation || !listWorkflows) return undefined
  if (!isToolDirect(agentProfile, TOOL.workflow)) return undefined
  if (!session.activatedTools.includes(TOOL.workflow)) return undefined
  const rootId = session.rootSessionId ?? session.id
  const stop = async (childId: string) => {
    dropExpectedReport(childId)
    await getAgentService()?.stopSession?.(childId, userId)
  }
  const { chatModel, catalog = [] } = input
  const deps = (runId: string): WorkflowAgentDeps => {
    const spend = getAgentService()?.sessionSpend
    return {
      opts: taskDelegation,
      stop,
      run: { id: runId, lane: { key: `workflow:${runId}`, cap: workflowConcurrency() } },
      ...(chatModel
        ? { route: async (asked) => workflowAgentRoute({ ...asked, chat: chatModel, catalog }) }
        : {}),
      isolate: async (name) => {
        const made = await input.worktreeHook?.(name)
        if (made) return adoptHookWorktree(made)
        return createAgentWorktree({ cwd: input.defaultCwd, name, group: rootId })
      },
      ...(spend ? { spend: (childId: string) => spend(userId, childId) } : {}),
      ...(input.pluginAgents ? { plugins: input.pluginAgents } : {}),
    }
  }
  return {
    scripts,
    list: listWorkflows,
    read: async (file) => {
      const stat = await fs.stat(file).catch(() => null)
      if (!stat?.isFile() || stat.size > MAX_WORKFLOW_BYTES) return null
      return fs.readFile(file, 'utf8').catch(() => null)
    },
    runAgent: (toolCallId, workflow, request, signal, runId) =>
      startWorkflowAgent(toolCallId, workflow, request, deps(runId), signal),
    runs: createWorkflowRunStore(path.join(input.runsRoot ?? workflowRunsRoot(), rootId)),
  }
}

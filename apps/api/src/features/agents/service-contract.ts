import type { CapabilityStores } from '../capabilities/store-factory'
import type { Kysely } from 'kysely'
import type { AgentAuthoredBlueprint } from '@localixai/agent/agents'

import type { AppDatabase } from '../../db'
import type { AgentRecord, AgentRecordInput, AgentSummary } from './contracts'
import type { InvocationRegistry } from '../capabilities/invocation'
import type { AgentBindings, PluginAgentGroup } from './bindings/bindings'
import type { AgentFolders } from './catalog/scan'
import type { AgentDelegation } from './delegation'
import type { AgentAvailability, ApprovalAnswer, RunAgentDecision } from './invocation-service'

/**
 * What the registry service promises, apart from how it keeps that promise.
 *
 * Split from the implementation because the composition root, the routes and three other
 * phases type against this and nothing else; the file they were pulling in to get it also
 * carries the file writes, the catalog assembly and the rule store.
 */

export interface AgentsServiceDeps {
  db: Kysely<AppDatabase>
  /** Opens the capability source and rule stores (supplied by the composition root). */
  capabilityStores: CapabilityStores
  /** Host-owned registry shared by catalog reads and launch admission. */
  invocations?: InvocationRegistry
  /** Claude Code's folders for a scope (`project` is null when its folder cannot be read now). */
  folders(userId: string, projectId: string): Promise<AgentFolders>
  /** The agents plugins bring, and whether each plugin is on. */
  plugins?(userId: string, projectId: string): Promise<readonly PluginAgentGroup[]>
  now?: () => string
}

export interface AgentsService extends AgentDelegation {
  /** Resolve definition and execution policy from the same admitted catalog snapshot. */
  resolveRunAgent(
    userId: string,
    agentId: string,
    host: string,
    projectId?: string | null,
    requestApproval?: (agent: AgentRecord) => Promise<ApprovalAnswer>,
  ): Promise<RunAgentDecision>
  /** The bindings that tie each definition to its stable id (the watcher reconciles through them). */
  bindings: AgentBindings
  /** The agents of one exact project or no-project scope, fused with enable-state. */
  listAgents(userId: string, opts?: { projectId?: string | null }): Promise<AgentSummary[]>
  /** Agents admitted without approval on this host, from one current registry snapshot. */
  listInvocableAgents(
    userId: string,
    host: string,
    opts?: { projectId?: string | null },
  ): Promise<AgentSummary[]>
  /** Explain the exact saved identity; an ask is not admitted without a pre-run handler. */
  explainAgentAvailability(
    userId: string,
    agentId: string,
    host: string,
    projectId?: string | null,
  ): Promise<AgentAvailability>
  /**
   * Refuse a policy change this registry cannot accept, before anything is written.
   *
   * Exactly one rule today: the agent the app itself runs on cannot be denied, in any scope.
   * A guard rather than a silent clamp, because a scope that quietly kept an agent the user
   * told it to drop would be lying in the very screen that reports what is in force.
   */
  assertPolicyChange(
    userId: string,
    projectId: string | null,
    deniedAgentIds: readonly string[],
  ): Promise<void>
  /** Enable / disable one agent (turn on an inert imported/dropped record). */
  setAgentEnabled(
    userId: string,
    name: string,
    enabled: boolean,
    projectId?: string | null,
    /** Switch it for ONE agent's scope instead of the project's. */
    agentId?: string | null,
  ): Promise<AgentSummary>
  /** One agent by name inside one exact scope, or null. */
  getAgent(userId: string, name: string, projectId?: string | null): Promise<AgentSummary | null>
  /**
   * Create an agent: a Claude Code agent file in the person's folder (or the project's), with its
   * policy in place first. Refuses a name the scope already holds; changing one is `updateAgent`.
   */
  createAgent(userId: string, input: AgentRecordInput): Promise<AgentSummary>
  /** Author behavior in the caller's registry, inheriting its saved policy once. */
  createAgentFromAgent(
    userId: string,
    input: AgentAuthoredBlueprint,
    origin: AgentCreationOrigin,
  ): Promise<AgentSummary>
  createAgentsFromAgent(
    userId: string,
    inputs: AgentAuthoredBlueprint[],
    origin: AgentCreationOrigin,
  ): Promise<AgentCreationBatchResult>
  /**
   * Replace behavior in the agent's own file, keeping its id and access. A rename moves the file
   * and keeps the id. Only a file the person owns (`editable`) can be changed.
   */
  updateAgent(
    userId: string,
    name: string,
    input: AgentRecordInput,
    projectId?: string | null,
  ): Promise<AgentSummary>
  /**
   * Delete the agent's file and purge its binding now. Refused for what is not a file the person
   * owns (a plugin's agent, a built-in type): switch it off instead.
   */
  deleteAgent(userId: string, name: string, projectId?: string | null): Promise<void>
  /** Copy definition, policy and enable choice into a fresh local identity in the same scope. */
  duplicateAgent(
    userId: string,
    name: string,
    newName: string,
    projectId?: string | null,
  ): Promise<AgentSummary>
  /**
   * Resolve a persisted identity in its exact scope. Never falls back to a matching handle.
   */
  resolveEnabledAgent(
    userId: string,
    agentId: string,
    projectId?: string | null,
  ): Promise<AgentRecord | null>
  /** Resolve an unattended launch. An ask requires a separate human approval flow. */
  resolveInvocableAgent(
    userId: string,
    agentId: string,
    host: string,
    projectId?: string | null,
  ): Promise<AgentRecord | null>
  /** Resolve a handle only while choosing a NEW assignment; persist the returned ID. */
  selectEnabledAgent(
    userId: string,
    handle: string,
    projectId?: string | null,
  ): Promise<AgentRecord | null>
}

export interface AgentCreationOrigin {
  projectId: string | null
  agentId: string
  sessionId: string
  operationId: string
}

export interface AgentCreationBatchResult {
  created: AgentSummary[]
  errors: { index: number; handle: string; code: string; message: string }[]
}

/** The management seam supplied to chat; policy changes stay in the existing user editor. */
export type AgentManagementPort = Pick<
  AgentsService,
  | 'listAgents'
  | 'getAgent'
  | 'createAgent'
  | 'createAgentFromAgent'
  | 'createAgentsFromAgent'
  | 'updateAgent'
  | 'duplicateAgent'
  | 'setAgentEnabled'
  | 'deleteAgent'
>

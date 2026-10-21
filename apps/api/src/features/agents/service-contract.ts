import type { CapabilityStores } from '../capabilities/store-factory'
import type { Kysely } from 'kysely'
import type { AgentAuthoredBlueprint } from '@localixai/agent/agents'

import type { AppDatabase } from '../../db'
import type { AgentRecord, AgentRecordInput, AgentSummary } from './contracts'
import type { ContributionReadError } from '../ext/contribution-reader'
import type { createRegistrationPolicyService } from './registration-policy'
import type { InvocationRegistry } from '../capabilities/invocation'
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
  /** Resolve a project's working directory (for project-scoped registry dirs). */
  resolveProjectCwd?: (userId: string, projectId: string) => Promise<string | null>
  /** Override the global NATIVE registry dir (tests). */
  globalDir?: string
  now?: () => string
  syncBundledContributions?: (userId: string, projectId: string) => Promise<void>
}

export interface AgentsService {
  /** Resolve definition and execution policy from the same admitted catalog snapshot. */
  resolveRunAgent(
    userId: string,
    agentId: string,
    host: string,
    projectId?: string | null,
    requestApproval?: (agent: AgentRecord) => Promise<ApprovalAnswer>,
  ): Promise<RunAgentDecision>
  registrationPolicy: ReturnType<typeof createRegistrationPolicyService>
  /** Registry agents visible to one exact project or no-project scope, fused with enable-state. */
  listAgents(userId: string, opts?: { projectId?: string | null }): Promise<AgentSummary[]>
  /** The person's record (`@human`) as this scope resolves it: project, installation, shipped. */
  getHuman(userId: string, projectId?: string | null): Promise<AgentRecord>
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
  listRegistrationDiagnostics(
    userId: string,
    projectId?: string | null,
  ): Promise<ContributionReadError[]>
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
   * Create a registry agent: writes a lossless `.json` file + an enabled row. Refuses a name
   * the scope already holds — changing an existing definition is `updateAgent`.
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
   * Replace behavior while retaining the registry-issued ID and capability choices.
   * Local handles may change without changing identity; shipped handles stay fixed.
   */
  updateAgent(
    userId: string,
    name: string,
    input: AgentRecordInput,
    projectId?: string | null,
  ): Promise<AgentSummary>
  /**
   * Remove every definition file carrying `name` in the scope and its enable-state row.
   * Refused for a builtin: there is no file to remove and the roster must keep its system
   * roles — use `resetAgent` to drop an override, or disable it.
   */
  deleteAgent(userId: string, name: string, projectId?: string | null): Promise<void>
  /** Drop the user's override of a builtin so the shipped definition applies again. */
  resetAgent(userId: string, name: string, projectId?: string | null): Promise<AgentSummary>
  /**
   * The definition this installation SHIPS for a name, whatever is on disk — what the editor
   * fills its fields with when the user asks for the defaults back, BEFORE anything is written.
   */
  agentDefaults(name: string): AgentRecord | null
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
  | 'resetAgent'
>

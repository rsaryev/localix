/**
 * The effective-config report: read every source, resolve, and say what is actually in force.
 *
 * The two things the report can get WRONG rather than merely incomplete live next door — a read
 * that failed is recorded by `./unread-inputs`, and `./provenance` refuses to attribute a value to
 * a source it could not read. This file is the sequence: which ports are read, in what order, and
 * how their answers are assembled.
 */
import { createHash } from 'node:crypto'
import type { AgentSettings } from '../user/contracts'
import { MODEL_ROUTING_TASKS, isModelRoutingTaskEnabled } from '../../contracts/model-task-catalog'
import type { ProjectSettings } from '../projects/contracts'
import { resolveEffectiveAgentConfig, type EffectiveConfigDefaults } from './effective-config'
import { buildDiagnostics, type ResolvedModel } from './validate'
import { buildProvenance } from './provenance'
import { createUnreadInputs } from './unread-inputs'
import { errorMessage } from '../../lib/errors'
import type { EffectiveConfigReport } from './contracts'
import { toolCatalogNames, type ToolCatalogMiniAppSource } from '../tools/catalog'
import type { PermissionRule } from '../projects/contracts'
import type { SkillOverrides } from '../agent-core/skill-overrides'

/** A session's runtime-relevant configuration view (never carries secrets). */
export interface SessionConfigView {
  projectId: string | null
  modelId: string | null
  providerConnectionId: string | null
}

/**
 * Narrow read-only ports the service composes. Bootstrap maps these to the live
 * services (user profile, projects, chat sessions, provider resolution, skills,
 * plugins) — keeping this module testable and decoupled from those features.
 */
export interface AgentConfigPorts {
  loadUserAgentSettings(userId: string): Promise<unknown>
  loadProjectSettings(userId: string, projectId: string): Promise<unknown>
  loadSession(userId: string, sessionId: string): Promise<SessionConfigView | null>
  /** Resolve a model to a working connection through the SAME runtime resolver the
   *  run pipeline uses; null when nothing resolves. Never returns a key/secret. */
  resolveModel(
    userId: string,
    modelId: string,
    preferredConnectionId?: string | null,
  ): Promise<ResolvedModel>
  /**
   * What the scope may use, from the capability resolver.
   *
   * A port because this report EXPLAINS the effective configuration and must show the same
   * answer the run gets — computing permissions or skill visibility from settings a second
   * time is what let the report and the run drift apart.
   */
  loadCapabilities(
    userId: string,
    projectId: string | null,
  ): Promise<{
    permissions: PermissionRule[]
    skillOverrides: SkillOverrides
    disabledTools: string[]
  }>
  listSkillNames(userId: string, projectId: string | null): Promise<string[]>
  listMiniApps(userId: string, projectId: string | null): Promise<ToolCatalogMiniAppSource[]>
  defaults?: EffectiveConfigDefaults
}

export interface GetEffectiveInput {
  userId: string
  projectId?: string
  sessionId?: string
}

export interface AgentConfigurationService {
  getEffective(input: GetEffectiveInput): Promise<EffectiveConfigReport>
}

const ROUTE_TASKS = MODEL_ROUTING_TASKS.filter((task) => task.key !== 'session')

/** Stable JSON — sorted keys — so the revision hash is deterministic. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v as Record<string, unknown>)
            .sort()
            .map((k) => [k, (v as Record<string, unknown>)[k]]),
        )
      : v,
  )
}

export function createAgentConfigurationService(
  ports: AgentConfigPorts,
): AgentConfigurationService {
  async function getEffective(input: GetEffectiveInput): Promise<EffectiveConfigReport> {
    const { userId } = input

    const unread = createUnreadInputs()
    const readOr = unread.readOr

    // 1. Session first — it may carry the project id + the authoritative model/mode.
    const session = input.sessionId
      ? await readOr(
          {
            code: 'session_unreadable',
            message: `Session ${input.sessionId} could not be read, so its model and mode are not reflected below`,
          },
          ports.loadSession(userId, input.sessionId),
          null,
        )
      : null
    const projectId = input.projectId ?? session?.projectId ?? null

    // 2. Raw persisted settings (never mutated).
    const userSettings = await readOr(
      {
        code: 'user_settings_unreadable',
        message:
          'Your user settings could not be read, so no value below can be attributed to them',
      },
      ports.loadUserAgentSettings(userId),
      null,
    )
    const projectSettings = projectId
      ? await readOr(
          {
            code: 'project_settings_unreadable',
            message: `The settings of project ${projectId} could not be read, so no value below can be attributed to them`,
          },
          ports.loadProjectSettings(userId, projectId),
          null,
        )
      : null

    // 3. Pure user→project precedence + migration diagnostics.
    const resolved = resolveEffectiveAgentConfig({
      userSettings,
      projectSettings,
      defaults: ports.defaults,
      projectScoped: Boolean(projectId),
    })
    const values = resolved.settings as AgentSettings & ProjectSettings

    // 4. Resolve models for the session + each configured workload route (others inherit).
    const resolvedModels: Record<string, ResolvedModel> = {}
    const jobs: Promise<void>[] = []
    const sessionModelId = session?.modelId ?? values.modelId ?? null
    if (sessionModelId) {
      jobs.push(
        ports
          .resolveModel(
            userId,
            sessionModelId,
            session?.providerConnectionId ?? values.providerConnectionId ?? null,
          )
          .catch((err: unknown) => {
            unread.note({
              code: 'model_unresolvable',
              severity: 'error',
              field: 'modelId',
              message: `The session model ${sessionModelId} could not be checked against its provider connection (${errorMessage(err)})`,
            })
            return null
          })
          .then((r) => {
            resolvedModels.session = r
          }),
      )
    }
    for (const task of ROUTE_TASKS) {
      const slot = task.key
      if (!isModelRoutingTaskEnabled(values, slot)) continue
      const s = values.modelRouting?.[slot]
      if (s?.modelId) {
        jobs.push(
          ports
            .resolveModel(userId, s.modelId, s.providerConnectionId)
            .catch((err: unknown) => {
              unread.note({
                code: 'model_unresolvable',
                severity: 'error',
                field: `modelRouting.${slot}.modelId`,
                message: `The ${slot} route's model ${s.modelId} could not be checked against its provider connection (${errorMessage(err)})`,
              })
              return null
            })
            .then((r) => {
              resolvedModels[`modelRouting.${slot}`] = r
            }),
        )
      }
    }
    await Promise.all(jobs)

    // 5. Cross-field validators + consumer resolution + tool surface.
    const [skillNames, miniApps] = await Promise.all([
      readOr(
        {
          code: 'skills_unreadable',
          message:
            'The skill list could not be read, so a skill override may be reported as unknown',
        },
        ports.listSkillNames(userId, projectId),
        [] as string[],
      ),
      readOr(
        {
          code: 'mini_apps_unreadable',
          message: 'The mini app list could not be read, so the tool surface below is incomplete',
        },
        ports.listMiniApps(userId, projectId),
        [] as ToolCatalogMiniAppSource[],
      ),
    ])
    const knownToolNames = toolCatalogNames(miniApps)
    const capabilities = await readOr(
      {
        code: 'capabilities_unreadable',
        message: 'Capability policy could not be read, so permissions and skills are omitted',
      },
      ports.loadCapabilities(userId, projectId),
      { permissions: [], skillOverrides: {}, disabledTools: [] },
    )
    const { diagnostics, consumers, tools } = buildDiagnostics({
      values,
      hasSession: session != null,
      resolvedModels,
      skillNames,
      knownToolNames,
      disabledTools: capabilities.disabledTools,
      skillOverrides: capabilities.skillOverrides,
    })

    // 6+7. Provenance and reload class. What the scope MAY USE comes from the resolver, not
    // from these settings — that is the whole point of it having moved.
    const { provenance, reload } = buildProvenance({
      values,
      userSettings,
      projectSettings,
      projectId,
      projectUnread: unread.failed('project_settings_unreadable'),
      userUnread: unread.failed('user_settings_unreadable'),
    })
    const permissions = capabilities.permissions.map((rule) => ({
      permission: rule.permission,
      pattern: rule.pattern,
      action: rule.action,
      ...(rule.message ? { message: rule.message } : {}),
      scope: 'effective' as const,
    }))

    const revision = createHash('sha256').update(stableStringify(values)).digest('hex').slice(0, 16)

    return {
      schemaVersion: resolved.schemaVersion,
      revision,
      scope: { userId, projectId, sessionId: input.sessionId ?? null },
      values: values as Record<string, unknown>,
      provenance,
      reload,
      diagnostics: [
        // First: what could not be read at all. Everything after it describes values that may
        // have been derived from those gaps.
        ...unread.list(),
        ...resolved.diagnostics.map((message) => ({
          code: 'settings_invalid',
          severity: 'warning' as const,
          message,
        })),
        ...diagnostics,
      ],
      consumers,
      tools,
      permissions,
      skills: Object.entries(capabilities.skillOverrides).flatMap(([name, override]) =>
        override ? [{ name, override }] : [],
      ),
      miniApps: miniApps.map(({ name, enabled }) => ({ name, enabled })),
    }
  }

  return { getEffective }
}

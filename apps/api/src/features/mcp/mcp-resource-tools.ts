import { z } from 'zod'
import {
  defineAgentTool,
  MAX_AGENT_SOURCES,
  type AgentSource,
  type AgentTool,
} from '@localixai/agent/agents'
import { TOOL } from '../agent-core/tool-names'

import type { McpServerRecord } from './repository'
import type {
  McpResourceContent,
  McpResourceDef,
  McpResourceTemplateDef,
} from './mcp-client-contracts'
import { mapCallResult, mcpAgentSource, type McpContentPart } from './mcp-result'

/**
 * The consolidated agent tool provided for servers that advertise the MCP
 * `resources` capability. Its actions list resources, list URI templates, and read
 * one URI. It is built per-run only when discovery found at least one
 * resource-capable server, then deferred with the rest of the MCP surface.
 *
 * Introspection-only (no writes). Content is bounded (`MAX_RESOURCE_CHARS`) so a
 * huge resource can't blow the context budget, mirroring the tool-result cap.
 */
export interface McpResourcePort {
  list(): Promise<McpResourceListRow[]>
  listTemplates(): Promise<McpResourceTemplateListRow[]>
  read(server: string, uri: string): Promise<McpResourceContent[]>
}

const MAX_RESOURCE_CHARS = 64_000
const MAX_RESOURCE_ROWS = 1_000
const MAX_RESOURCE_FIELD_CHARS = 2_000
const RESOURCE_LIST_TRUNCATION = '\n[Additional MCP resources omitted: output budget reached.]'
const MCP_RESOURCE_ACTIONS = ['list', 'list_templates', 'read'] as const
type McpResourceAction = (typeof MCP_RESOURCE_ACTIONS)[number]
interface McpResourceInput {
  action: McpResourceAction
  server?: string
  uri?: string
}

export function createMcpResourceTools(
  port: McpResourcePort,
  servers: string[],
  allowedActions: readonly McpResourceAction[] = MCP_RESOURCE_ACTIONS,
): AgentTool[] {
  if (allowedActions.length === 0) return []
  const serverList = servers.join(', ')
  const inputShape: Record<string, z.ZodType> = {
    action: z
      .enum(allowedActions as [McpResourceAction, ...McpResourceAction[]])
      .describe(
        allowedActions.length === 1
          ? `The only enabled operation: ${allowedActions[0]}.`
          : 'Whether to list resources, list URI templates, or read one resource.',
      ),
  }
  if (allowedActions.includes('read')) {
    inputShape.server = z
      .string()
      .min(1)
      .optional()
      .describe('Required for action="read": the MCP server exposing the resource.')
    inputShape.uri = z
      .string()
      .min(1)
      .max(4_096)
      .optional()
      .describe('Required for action="read": a URI returned by action="list".')
  }

  const tool = defineAgentTool<McpResourceInput>({
    name: TOOL.McpResources,
    description: [
      `Inspect resources exposed by connected MCP servers (${serverList}).`,
      ...(allowedActions.includes('list')
        ? ['Use action="list" to discover concrete resource URIs.']
        : []),
      ...(allowedActions.includes('list_templates')
        ? ['Use action="list_templates" to discover URI templates.']
        : []),
      ...(allowedActions.includes('read')
        ? ['Use action="read" with server + uri to fetch one resource.']
        : []),
    ].join(' '),
    inputSchema: z.object(inputShape) as unknown as z.ZodType<McpResourceInput>,
    activeVerb: 'Reading MCP resources',
    executionMode: 'parallel',
    // Every action lists or reads (`resources/list`, `resources/templates/list`,
    // `resources/read`); MCP has no resource write. Stated, because silence reads as `external`.
    mutates: false,
    async execute(_toolCallId, input) {
      if (input.action === 'read') {
        if (!input.server || !input.uri) {
          return {
            content: 'action="read" requires both server and uri.',
            isError: true,
          }
        }
        const contents = await port.read(input.server, input.uri)
        if (contents.length === 0) {
          const source = mcpAgentSource({
            uri: input.uri,
            consulted: false,
            provider: `MCP · ${input.server}`,
          })
          return {
            content: `[empty resource ${input.uri}]`,
            ...(source ? { sources: [source] } : {}),
          }
        }
        const contentParts: McpContentPart[] = contents
          .slice(0, MAX_AGENT_SOURCES)
          .map((content) => ({
            type: 'resource' as const,
            resource: {
              uri: content.uri,
              ...('text' in content && typeof content.text === 'string'
                ? { text: content.text }
                : {}),
              ...('blob' in content && typeof content.blob === 'string'
                ? { blob: content.blob }
                : {}),
              ...(content.mimeType ? { mimeType: content.mimeType } : {}),
            },
          }))
        if (contents.length > MAX_AGENT_SOURCES) {
          contentParts.push({
            type: 'text',
            text: `[${contents.length - MAX_AGENT_SOURCES} additional MCP resource parts omitted]`,
          })
        }
        return mapCallResult(contentParts, false, MAX_RESOURCE_CHARS, {
          provider: `MCP · ${input.server}`,
        })
      }

      if (input.action === 'list_templates') {
        const resourceTemplates = await port.listTemplates()
        if (resourceTemplates.length === 0) {
          return {
            content: 'No MCP resource templates are currently available.',
            details: {
              resourceTemplates: [] as McpResourceTemplateListRow[],
              totalCount: 0,
              truncated: false,
            },
          }
        }
        const visibleTemplates = resourceTemplates.slice(0, MAX_RESOURCE_ROWS)
        const lines = visibleTemplates.map(formatResourceTemplateRow)
        const rendered = capResourceListContent(
          `${resourceTemplates.length} MCP resource template(s):`,
          lines,
        )
        return {
          content: rendered.content,
          details: {
            resourceTemplates: visibleTemplates,
            totalCount: resourceTemplates.length,
            truncated: visibleTemplates.length < resourceTemplates.length || rendered.truncated,
          },
        }
      }

      const resources = await port.list()
      if (resources.length === 0) {
        return {
          content: 'No MCP resources are currently available.',
          details: {
            resources: [] as McpResourceListRow[],
            totalCount: 0,
            truncated: false,
          },
        }
      }
      const visibleResources = resources.slice(0, MAX_RESOURCE_ROWS)
      const lines = visibleResources.map(formatResourceRow)
      const rendered = capResourceListContent(`${resources.length} MCP resource(s):`, lines)
      return {
        content: rendered.content,
        sources: visibleResources
          .slice(0, MAX_AGENT_SOURCES)
          .map((resource) =>
            mcpAgentSource({
              uri: resource.uri,
              title: resource.name,
              snippet: resource.description,
              consulted: false,
              provider: `MCP · ${resource.server}`,
              mimeType: resource.mimeType,
            }),
          )
          .filter((source): source is AgentSource => source !== undefined),
        details: {
          resources: visibleResources,
          totalCount: resources.length,
          truncated: visibleResources.length < resources.length || rendered.truncated,
        },
      }
    },
  })

  return [tool]
}

function clipResourceField(value: string): string {
  return value.length > MAX_RESOURCE_FIELD_CHARS
    ? `${value.slice(0, MAX_RESOURCE_FIELD_CHARS - 1)}…`
    : value
}

function formatAnnotations(annotations: McpResourceDef['annotations']): string {
  if (!annotations) return ''
  const serialized = JSON.stringify(annotations)
  return ` [annotations: ${clipResourceField(serialized)}]`
}

function formatResourceRow(resource: McpResourceListRow): string {
  return `- [${clipResourceField(resource.server)}] ${clipResourceField(resource.uri)}${resource.name ? ` — ${clipResourceField(resource.name)}` : ''}${resource.description ? ` (${clipResourceField(resource.description)})` : ''}${formatAnnotations(resource.annotations)}`
}

function formatResourceTemplateRow(template: McpResourceTemplateListRow): string {
  return `- [${clipResourceField(template.server)}] ${clipResourceField(template.uriTemplate)} — ${clipResourceField(template.name)}${template.description ? ` (${clipResourceField(template.description)})` : ''}${formatAnnotations(template.annotations)}`
}

function capResourceListContent(
  header: string,
  lines: string[],
): { content: string; truncated: boolean } {
  const content = `${header}\n${lines.join('\n')}`
  if (content.length <= MAX_RESOURCE_CHARS) return { content, truncated: false }
  const keep = MAX_RESOURCE_CHARS - RESOURCE_LIST_TRUNCATION.length
  return {
    content: `${content.slice(0, keep).trimEnd()}${RESOURCE_LIST_TRUNCATION}`,
    truncated: true,
  }
}

/** Convenience: build the tools from the process client manager + this run's servers. */
export function buildMcpResourceTools(args: {
  resourceServers: string[]
  servers: McpServerRecord[]
  cwd: string
  /** Effective user/project denylist shared with built-in, mini app, and MCP call tools. */
  disabledTools?: ReadonlySet<string>
  manager: {
    listResources(servers: McpServerRecord[], cwd: string): Promise<McpResourceListRow[]>
    listResourceTemplates(
      servers: McpServerRecord[],
      cwd: string,
    ): Promise<McpResourceTemplateListRow[]>
    readResource(
      servers: McpServerRecord[],
      cwd: string,
      server: string,
      uri: string,
    ): Promise<McpResourceContent[]>
  }
}): AgentTool[] {
  if (args.resourceServers.length === 0) return []
  const port: McpResourcePort = {
    list: () => args.manager.listResources(args.servers, args.cwd),
    listTemplates: () => args.manager.listResourceTemplates(args.servers, args.cwd),
    read: (server, uri) => args.manager.readResource(args.servers, args.cwd, server, uri),
  }
  const disabledTools = args.disabledTools
  if (disabledTools?.has(TOOL.McpResources)) return []
  const allowedActions = [
    ...(!disabledTools?.has('list_mcp_resources') ? (['list'] as const) : []),
    ...(!disabledTools?.has('list_mcp_resource_templates') ? (['list_templates'] as const) : []),
    ...(!disabledTools?.has('read_mcp_resource') ? (['read'] as const) : []),
  ]
  return createMcpResourceTools(port, args.resourceServers, allowedActions)
}

export type McpResourceListRow = McpResourceDef & { server: string }
export type McpResourceTemplateListRow = McpResourceTemplateDef & { server: string }

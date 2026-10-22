import type { HumanInLoopRequestBase, HumanInLoopResponseBase } from '@localixai/agent/agents'

/**
 * The `mcp_elicitation` HITL contract: an MCP server asks the person for input in the middle of
 * one of its tool calls (`elicitation/create`). The card is raised in the chat whose tool call
 * the server is serving, under that call's id, so it is answered, expires and is cleared like an
 * `ask`. Types and pure helpers only: the MCP client raises it, Claude Code hooks may answer it
 * first, the chat surface renders it.
 */

/** What the server receives: the person (or a hook) submitted, refused, or dismissed it. */
export type McpElicitationAction = 'accept' | 'decline' | 'cancel'

/** A submitted form value, as the protocol allows it. */
export type McpElicitationValue = string | number | boolean | string[]
export type McpElicitationContent = Record<string, McpElicitationValue>

/** One field of a form request: the protocol's restricted, flat JSON Schema subset. */
export interface McpElicitationField {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array'
  title?: string
  description?: string
  minLength?: number
  maxLength?: number
  format?: 'email' | 'uri' | 'date' | 'date-time'
  minimum?: number
  maximum?: number
  enum?: string[]
  enumNames?: string[]
  oneOf?: Array<{ const: string; title: string }>
  minItems?: number
  maxItems?: number
  items?: { type?: 'string'; enum?: string[]; anyOf?: Array<{ const: string; title: string }> }
  default?: McpElicitationValue
}

export interface McpElicitationSchema {
  type: 'object'
  properties: Record<string, McpElicitationField>
  required?: string[]
}

export interface McpElicitationPayload {
  /** The server's configured name: what the card names and what hook matchers test. */
  server: string
  message: string
  mode: 'form' | 'url'
  /** Form mode: the fields to fill. */
  requestedSchema?: McpElicitationSchema
  /** URL mode: the page the person is asked to open. */
  url?: string
  elicitationId?: string
}

export type McpElicitationRequest = HumanInLoopRequestBase<'mcp_elicitation', McpElicitationPayload>

/** What the card sends back as its `answers`. */
export interface McpElicitationAnswer {
  action: McpElicitationAction
  content?: McpElicitationContent
}

export type McpElicitationResponse = HumanInLoopResponseBase<
  'mcp_elicitation',
  { answers: McpElicitationAnswer }
>

/** The request as the Claude Code `Elicitation` hook reads it. */
export interface McpElicitationHookRequest {
  server: string
  message: string
  mode: 'form' | 'url'
  requestedSchema?: McpElicitationSchema
  url?: string
  elicitationId?: string
}

/**
 * The run's Claude Code hooks around an elicitation, handed to the MCP tool through its execution
 * context (`cc-hooks/wrap-tools.ts`). `before` may answer for the person and skip the card;
 * `after` sees the person's answer and may replace or block it. Absent: no hook is registered.
 */
export interface McpElicitationHooks {
  before(request: McpElicitationHookRequest): Promise<McpElicitationAnswer | undefined>
  after(
    request: McpElicitationHookRequest,
    answer: McpElicitationAnswer,
  ): Promise<McpElicitationAnswer | undefined>
}

/** The execution-context field that carries {@link McpElicitationHooks}. */
export interface McpElicitationHookCarrier {
  mcpElicitationHooks?: McpElicitationHooks
}

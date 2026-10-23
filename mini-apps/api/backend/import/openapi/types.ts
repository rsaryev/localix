/**
 * The slice of OpenAPI 3 this importer actually reads.
 *
 * Hand-written rather than pulled from `openapi-types`, for one reason: a spec in the wild does
 * not obey the types. Every field here arrives from `JSON.parse` or a YAML document — i.e. from
 * `unknown`, whatever the types claim. Narrow, optional, defensive shapes make the reader honest
 * about that; a strict type would only move the lie earlier.
 */

export interface OAServerVariable {
  default?: string
  enum?: string[]
}

export interface OAServer {
  url?: string
  variables?: Record<string, OAServerVariable>
}

/** A schema node. `$ref` and the composition keywords are the ones we resolve. */
export interface OASchema {
  $ref?: string
  type?: string
  format?: string
  example?: unknown
  default?: unknown
  readOnly?: boolean
  properties?: Record<string, OASchema>
  items?: OASchema
  allOf?: OASchema[]
  oneOf?: OASchema[]
  anyOf?: OASchema[]
  enum?: unknown[]
  required?: string[]
}

export interface OAParameter {
  $ref?: string
  name?: string
  in?: string
  required?: boolean
  deprecated?: boolean
  schema?: OASchema
  example?: unknown
}

export interface OAMediaType {
  schema?: OASchema
  example?: unknown
}

export interface OARequestBody {
  $ref?: string
  required?: boolean
  content?: Record<string, OAMediaType>
}

export interface OAOperation {
  operationId?: string
  summary?: string
  description?: string
  deprecated?: boolean
  tags?: string[]
  parameters?: OAParameter[]
  requestBody?: OARequestBody
  security?: Record<string, string[]>[]
  servers?: OAServer[]
}

export interface OASecurityScheme {
  $ref?: string
  type?: string
  scheme?: string
  name?: string
  in?: string
  bearerFormat?: string
}

export interface OAPathItem {
  parameters?: OAParameter[]
  servers?: OAServer[]
  [method: string]: unknown
}

export interface OADocument {
  openapi?: string
  info?: { title?: string; version?: string }
  servers?: OAServer[]
  paths?: Record<string, OAPathItem>
  components?: {
    schemas?: Record<string, OASchema>
    parameters?: Record<string, OAParameter>
    requestBodies?: Record<string, OARequestBody>
    securitySchemes?: Record<string, OASecurityScheme>
  }
  security?: Record<string, string[]>[]
}

/** The HTTP verbs a path item may carry. Everything else under a path is not an operation. */
export const OA_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch'] as const

/** `x-anything` is a spec extension, never an operation. */
export function isSpecExtension(key: string): boolean {
  return key.startsWith('x-')
}

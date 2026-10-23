/**
 * Swagger 2.0 → requests, by TRANSLATING it into OpenAPI 3 and reusing the importer we have.
 *
 * A Swagger 2.0 document used to be claimed by nobody: every importer in the chain declined it and
 * the paste came back "format not recognised". Measured. That is a lot of API to not read — 2.0 is
 * still what a great many internal and vendor specs publish.
 *
 * WHY A TRANSLATOR AND NOT AN IMPORTER. The reference ports this as its own 544-line module plus a
 * dependency on `@apidevtools/swagger-parser`. It does not need to be: the two formats disagree
 * about how to SPELL four things — the base url, a body, a form, a security scheme — and agree on
 * everything else. Paths, operations, `parameters` bucketed by `in`, `$ref`, examples, required-ness:
 * identical. So this normalises the spelling and hands the result to `convertOpenApiDocument`.
 *
 * That is not just less code. It means the OA3 importer's `$ref` resolution, its example generation,
 * its `{placeholder}` → `:placeholder` rewrite and its "report an auth scheme we cannot sign rather
 * than importing it as none" all serve Swagger 2 for free — and the next fix to any of them serves
 * both formats instead of one, which is the failure mode this mini app keeps finding (the same
 * knowledge in two copies, one of them quietly drifting).
 *
 * The differences, all four:
 *
 *   base url   `schemes` + `host` + `basePath`   →  `servers: [{ url }]`
 *   body       `parameters[in=body].schema`      →  `requestBody.content[mime].schema`
 *   form       `parameters[in=formData]`         →  `requestBody.content[form-mime].schema`
 *   security   `securityDefinitions`             →  `components.securitySchemes`
 *
 * plus one shape detail: a 2.0 parameter carries `type`/`format` directly, where a 3.0 one wraps
 * them in `schema`. Everything the example generator does keys off `schema`, so that is lifted.
 */

import { convertOpenApiDocument, parseDocument } from './openapi'
import type { ImportedRequest, Importer, ImportOptions } from './types'
import type { OADocument } from './openapi/types'

/** The only version this reads. `swagger: "2.0"` is the document's own self-declaration. */
const SWAGGER_2 = '2.0'

interface Swagger2Parameter {
  name?: string
  in?: string
  required?: boolean
  type?: string
  format?: string
  schema?: unknown
  items?: unknown
  enum?: unknown[]
  default?: unknown
  description?: string
  [key: string]: unknown
}

interface Swagger2Document {
  swagger?: string
  host?: string
  basePath?: string
  schemes?: string[]
  consumes?: string[]
  securityDefinitions?: Record<string, unknown>
  paths?: Record<string, unknown>
  [key: string]: unknown
}

const FORM_MIME = 'application/x-www-form-urlencoded'
const MULTIPART_MIME = 'multipart/form-data'

/**
 * `schemes` + `host` + `basePath` → one server url.
 *
 * A 2.0 document may omit all three, and legitimately: the spec says they then mean "same host as
 * where the document was served from", which we have no way to know. That produces a RELATIVE
 * url — and `baseUrlFrom` already has an answer for exactly that, because an OpenAPI 3 spec can
 * declare a relative server too. It reports it and asks for `baseUrl`. Same path, no new message.
 *
 * https wins when both schemes are offered: a spec listing both means the API does TLS, and this
 * client resolves ${secret:KEY} credentials at send time.
 */
export function serverUrlFrom(document: Swagger2Document): string {
  const basePath = typeof document.basePath === 'string' ? document.basePath : ''
  const host = typeof document.host === 'string' ? document.host : ''
  if (!host) return basePath || '/'
  const schemes = Array.isArray(document.schemes)
    ? document.schemes.filter((s) => typeof s === 'string')
    : []
  const scheme = schemes.includes('https') ? 'https' : (schemes[0] ?? 'https')
  return `${scheme}://${host}${basePath}`
}

/**
 * A 2.0 parameter → a 3.0 one.
 *
 * The payload is the same; only the wrapper moved. Everything downstream (the example generator
 * above all) reads `schema`, so a bare `type: string` has to become `schema: { type: 'string' }` or
 * every generated example silently becomes empty.
 */
export function parameterToOA3(parameter: Swagger2Parameter): Record<string, unknown> {
  const { type, format, items, enum: enums, default: dflt, ...rest } = parameter
  if (parameter.schema) return rest as Record<string, unknown>
  return {
    ...rest,
    schema: {
      ...(type !== undefined ? { type } : {}),
      ...(format !== undefined ? { format } : {}),
      ...(items !== undefined ? { items } : {}),
      ...(enums !== undefined ? { enum: enums } : {}),
      ...(dflt !== undefined ? { default: dflt } : {}),
    },
  }
}

/** The mime a body/form should be declared under, honouring the operation's own `consumes`. */
function mimeFor(consumes: unknown, fallback: string): string {
  const list = Array.isArray(consumes)
    ? consumes.filter((c): c is string => typeof c === 'string')
    : []
  return list[0] ?? fallback
}

/**
 * Split a 2.0 operation's `parameters` into the 3.0 shape: the ones that stay, plus a `requestBody`.
 *
 * 2.0 keeps a body in the SAME array as headers and query — `in: 'body'` for a raw payload,
 * `in: 'formData'` for form fields. 3.0 lifts both out into `requestBody`. Left unsplit, our
 * bucketer would read a body parameter as a header named "body".
 */
export function operationToOA3(
  operation: Record<string, unknown>,
  documentConsumes: unknown,
): Record<string, unknown> {
  const parameters = Array.isArray(operation.parameters)
    ? (operation.parameters as Swagger2Parameter[])
    : []
  const consumes = operation.consumes ?? documentConsumes

  const body = parameters.find((p) => p?.in === 'body')
  const formFields = parameters.filter((p) => p?.in === 'formData')
  const rest = parameters.filter((p) => p?.in !== 'body' && p?.in !== 'formData')

  const out: Record<string, unknown> = { ...operation, parameters: rest.map(parameterToOA3) }

  if (body?.schema) {
    out.requestBody = {
      ...(body.required ? { required: true } : {}),
      content: { [mimeFor(consumes, 'application/json')]: { schema: body.schema } },
    }
  } else if (formFields.length > 0) {
    // A `type: file` field means multipart, whatever `consumes` says — that is the only way to
    // carry a file, and a spec that forgets to declare it is still describing multipart.
    const mime = formFields.some((f) => f.type === 'file')
      ? MULTIPART_MIME
      : mimeFor(consumes, FORM_MIME)
    out.requestBody = {
      content: {
        [mime]: {
          schema: {
            type: 'object',
            properties: Object.fromEntries(
              formFields.map((f) => [
                f.name ?? '',
                (parameterToOA3(f) as { schema: unknown }).schema,
              ]),
            ),
            required: formFields.flatMap((field) =>
              field.required && field.name ? [field.name] : [],
            ),
          },
        },
      },
    }
  }
  return out
}

const OA_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch']

/** The whole document, translated. */
export function toOpenApi3(document: Swagger2Document): OADocument {
  const paths: Record<string, unknown> = {}
  for (const [path, rawItem] of Object.entries(document.paths ?? {})) {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) continue
    const item = rawItem as Record<string, unknown>
    const out: Record<string, unknown> = { ...item }
    // A path-level `parameters` list is shared by every operation under it and needs the same
    // lift; our `mergeParameters` reads it.
    if (Array.isArray(item.parameters)) {
      out.parameters = (item.parameters as Swagger2Parameter[]).map(parameterToOA3)
    }
    for (const method of OA_METHODS) {
      const operation = item[method]
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) continue
      out[method] = operationToOA3(operation as Record<string, unknown>, document.consumes)
    }
    paths[path] = out
  }

  const {
    swagger: _swagger,
    host: _host,
    basePath: _basePath,
    schemes: _schemes,
    consumes: _consumes,
    securityDefinitions,
    definitions,
    ...rest
  } = document

  return {
    ...rest,
    // The version our importer gates on. It is a translation, and it says so.
    openapi: '3.0.0',
    servers: [{ url: serverUrlFrom(document) }],
    paths,
    components: {
      ...(rest.components as object),
      ...(securityDefinitions ? { securitySchemes: securityDefinitions } : {}),
      // 2.0 keeps schemas under `definitions` and refs them as `#/definitions/X`. Both spellings
      // are kept: `resolveRef` walks the pointer literally, so a `#/definitions/Pet` in an
      // untouched schema must still land somewhere.
      ...(definitions ? { schemas: definitions } : {}),
    },
    ...(definitions ? { definitions } : {}),
  } as OADocument
}

export function convertSwagger2(text: string, options?: ImportOptions): ImportedRequest[] | null {
  const document = parseDocument(text) as Swagger2Document | null
  if (!document || document.swagger !== SWAGGER_2) return null
  // `notesKey` is the ORIGINAL text: the notes are looked up by what the user pasted, not by the
  // translation, which no caller has.
  return convertOpenApiDocument(toOpenApi3(document), text, options)
}

export const swagger2Importer: Importer = {
  id: 'swagger2',
  name: 'Swagger 2.0',
  convert: convertSwagger2,
}

/**
 * The MODEL-FACING CONTRACT of `http_request`, split out of the tool body per the repo
 * convention (exemplar: mini-apps/trading/backend/manage-chart-schema.ts):
 *
 *  1. ONE flat `z.object` with an `action` enum and per-action params as OPTIONAL siblings.
 *  2. Every `.describe()` says WHICH action needs the field and shows a literal example.
 *  3. Rules the flat schema cannot express live in the pure `httpRequestProblem()` fix-it
 *     helper in `http-request-problem.ts`, separate from the schema descriptions and tool body.
 *
 * zod is imported as a TYPE only; the runtime instance is the host's `ctx.z`, threaded in.
 */

import type { z as Zod } from 'zod'
import { AUTH_TYPES, HTTP_METHODS } from './request-spec'

export const HTTP_REQUEST_ACTIONS = [
  'send',
  'save',
  'list',
  'get',
  'delete',
  'import',
  'export',
] as const

export interface PairInput {
  name: string
  value: string
  disabled?: boolean
}

export interface HttpRequestInput {
  action: (typeof HTTP_REQUEST_ACTIONS)[number]
  name?: string
  url?: string
  method?: string
  headers?: PairInput[]
  query?: PairInput[]
  pathParams?: PairInput[]
  body?: string
  contentType?: string
  form?: PairInput[]
  authType?: (typeof AUTH_TYPES)[number]
  username?: string
  password?: string
  token?: string
  apiKeyName?: string
  apiKeyValue?: string
  apiKeyIn?: 'header' | 'query' | 'cookie'
  followRedirects?: boolean
  timeoutMs?: number
  maxRedirects?: number
  source?: string
  save?: boolean
  baseUrl?: string
  dir?: string
  names?: string[]
  filter?: string
}

/**
 * Every field a REQUEST action takes, `action` included.
 *
 * Split out so the merged `api_client` schema can compose it with the environment fields instead
 * of keeping a second copy of forty `.describe()` strings. Those descriptions ARE the contract the
 * model reads; two copies of them is two contracts, and the one that drifts is the one nobody
 * notices.
 */
export function requestFields(z: typeof Zod) {
  const pair = z.object({
    name: z.string().describe('Pair name, e.g. `Accept`.'),
    value: z.string().describe('Pair value, e.g. `application/json`.'),
    disabled: z.boolean().optional().describe('Set true to keep the pair but not send it.'),
  })

  return {
    action: z
      .enum(HTTP_REQUEST_ACTIONS)
      .describe(
        '`send` performs a request now; `save` stores one under `name` for reuse; ' +
          '`list` shows saved requests; `get` shows one saved request; `delete` removes one; ' +
          '`import` turns a pasted cURL command, OpenAPI 3 spec or HAR archive into requests, or reads back ' +
          'previously exported files from a `dir`; `export` writes saved requests into the repo to share them. ' +
          '`send` with only a `name` re-sends that saved request.',
      ),
    name: z
      .string()
      .optional()
      .describe(
        'For save/get/delete: the saved request name, e.g. `github-user`. ' +
          'For send: re-send the saved request with this name (its fields may be overridden by the ones below).',
      ),
    filter: z
      .string()
      .optional()
      .describe(
        'For send: a JSONPath applied to the JSON response, so only the part you need is returned, ' +
          'e.g. `$.data.token` or `$.items[*].id`. STRONGLY preferred over reading a large payload: ' +
          'the whole body stays in the conversation and costs tokens on every later turn. ' +
          'The unfiltered response is still saved to the request history, so nothing is lost.',
      ),
    url: z
      .string()
      .optional()
      .describe(
        'For send/save: the full http(s) URL, e.g. `https://api.github.com/users/octocat`. ' +
          'May use environment variables, e.g. `{{base_url}}/users/octocat` — resolved against the ' +
          'active environment when sent (manage it with target="environment" on `api_client`).',
      ),
    method: z
      .enum(HTTP_METHODS)
      .optional()
      .describe('For send/save: HTTP method. Defaults to `GET`.'),
    headers: pair.array().optional().describe('For send/save: request headers.'),
    query: pair
      .array()
      .optional()
      .describe('For send/save: query parameters, appended to any already in `url`.'),
    pathParams: pair
      .array()
      .optional()
      .describe(
        'For send/save: values for `:name` placeholders in the url. For `https://api.github.com/repos/:owner/:repo` ' +
          'pass [{"name":"owner","value":"acme"},{"name":"repo","value":"widgets"}]. An unfilled placeholder is left in the url.',
      ),
    body: z
      .string()
      .optional()
      .describe(
        'For send/save with POST/PUT/PATCH/DELETE: the raw request body, e.g. `{"name":"Ada"}`. ' +
          'Ignored for GET/HEAD/OPTIONS.',
      ),
    contentType: z
      .string()
      .optional()
      .describe(
        'For send/save: the body media type, e.g. `application/json`. Defaults to `application/json` when `body` is set.',
      ),
    form: pair
      .array()
      .optional()
      .describe(
        'For send/save: form fields, sent url-encoded. Use INSTEAD of `body`, not with it.',
      ),
    authType: z
      .enum(AUTH_TYPES)
      .optional()
      .describe(
        '`none` (default), `basic` (needs username+password), `bearer` (needs token), ' +
          '`apikey` (needs apiKeyName+apiKeyValue).',
      ),
    username: z.string().optional().describe('For authType=basic.'),
    password: z
      .string()
      .optional()
      .describe(
        'For authType=basic. May be a vault reference like `${secret:GITHUB_PASSWORD}` instead of a literal — preferred when saving.',
      ),
    token: z
      .string()
      .optional()
      .describe(
        'For authType=bearer. May be a vault reference like `${secret:GITHUB_TOKEN}` instead of a literal — preferred when saving.',
      ),
    apiKeyName: z
      .string()
      .optional()
      .describe('For authType=apikey: the header/param name, e.g. `X-Api-Key`.'),
    apiKeyValue: z
      .string()
      .optional()
      .describe(
        'For authType=apikey: the key value. May be a vault reference like `${secret:OPENAI_KEY}`.',
      ),
    apiKeyIn: z
      .enum(['header', 'query', 'cookie'])
      .optional()
      .describe('For authType=apikey: where to put the key. Defaults to `header`.'),
    followRedirects: z
      .boolean()
      .optional()
      .describe('For send/save: follow 3xx responses. Defaults to true.'),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'For send/save: timeout for the whole request including redirects, in milliseconds, e.g. `60000`. Omit to use the mini app default.',
      ),
    maxRedirects: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'For send/save: maximum redirects to follow, e.g. `5`. Use `followRedirects:false` to follow none.',
      ),
    source: z
      .string()
      .optional()
      .describe(
        'For import: the text to import. A cURL command (e.g. `curl -H "Accept: application/json" https://api.github.com/users/octocat`), ' +
          'an OpenAPI 3 spec (JSON or YAML — every endpoint becomes a request), or a HAR 1.2 archive. ' +
          'Paste it verbatim; the format is detected.',
      ),
    save: z
      .boolean()
      .optional()
      .describe(
        'For import: store the imported requests instead of only showing them. Defaults to false, so an import previews first.',
      ),
    dir: z
      .string()
      .optional()
      .describe(
        'For export, and for import from disk: the directory inside the working tree, e.g. `.localix/rest` (the default). ' +
          'Must stay inside the project. On import, reading a dir means "load the requests this repo shares" — pass no "source".',
      ),
    names: z
      .string()
      .array()
      .optional()
      .describe('For export: only these saved requests. Every one when omitted.'),
    baseUrl: z
      .string()
      .optional()
      .describe(
        'For import of an OpenAPI spec that declares a RELATIVE server (e.g. `url: /api/v3`): the origin to resolve it ' +
          'against, e.g. `https://petstore3.swagger.io`. The spec cannot state this — it means "wherever this document ' +
          'was served from". Ignored when the spec names an absolute server.',
      ),
  }
}

/** The standalone `http_request` shape — the merged tool composes `requestFields` directly. */
export function buildHttpRequestSchema(z: typeof Zod) {
  return z.object(requestFields(z))
}

export { httpRequestProblem } from './http-request-problem'

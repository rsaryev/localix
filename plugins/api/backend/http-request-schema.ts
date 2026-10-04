/**
 * The MODEL-FACING CONTRACT of `http_request`, split out of the tool body per the repo
 * convention (exemplar: plugins/trading/backend/manage-chart-schema.ts):
 *
 *  1. ONE flat `z.object` with an `action` enum and per-action params as OPTIONAL siblings.
 *  2. Every `.describe()` says WHICH action needs the field and shows a literal example.
 *  3. Rules the flat schema cannot express live in the pure `httpRequestProblem()` fix-it
 *     helper. Every lesson about misuse lands HERE, never in the body.
 *
 * zod is imported as a TYPE only; the runtime instance is the host's `ctx.z`, threaded in.
 */

import type { z as Zod } from 'zod'
import { AUTH_TYPES, HTTP_METHODS, isHttpUrl, parseMethod } from './request-spec'
import { hasTemplate } from './template'

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
        'For send/save: timeout for the whole request including redirects, in milliseconds, e.g. `60000`. Omit to use the plugin default.',
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

/**
 * Required-field guards the flat schema cannot express, answered as fix-it messages. Pure and
 * zod-free, so a unit test covers it with no host at all.
 */
export function httpRequestProblem(input: HttpRequestInput): string | null {
  const { action } = input

  if ((action === 'get' || action === 'delete' || action === 'save') && !input.name?.trim()) {
    return `action="${action}" needs a "name", e.g. {"action":"${action}","name":"github-user"}.`
  }
  if (action === 'save' && !input.url?.trim()) {
    return 'action="save" needs a "url", e.g. {"action":"save","name":"github-user","url":"https://api.github.com/users/octocat"}.'
  }
  if (action === 'send' && !input.url?.trim() && !input.name?.trim()) {
    return 'action="send" needs a "url" (e.g. {"action":"send","url":"https://api.github.com/users/octocat"}) or the "name" of a saved request.'
  }
  if (action === 'import' && !input.source?.trim() && input.dir === undefined) {
    return 'action="import" needs a "source" (text to import, e.g. {"action":"import","source":"curl https://api.github.com/users/octocat"}) or a "dir" to read exported files from, e.g. {"action":"import","dir":".localix/rest","save":true}.'
  }
  if (action === 'import' && input.source?.trim() && input.dir !== undefined) {
    return 'Pass "source" (text) or "dir" (files on disk), not both.'
  }
  // A url holding `{{ variables }}` is NOT checkable yet: `{{base_url}}/users` only becomes a url
  // once an environment renders it, and refusing it here would make the whole variable feature
  // unusable at its front door. The check moves to send time, after the render — see `send`.
  if (input.url && !hasTemplate(input.url) && !isHttpUrl(input.url)) {
    return `"${input.url}" is not an http(s) URL. Write the full URL including the scheme, e.g. \`https://api.github.com\`, or use a variable like \`{{base_url}}/users\`.`
  }
  if (input.method && !parseMethod(input.method)) {
    return `"${input.method}" is not a supported method. Use one of: ${HTTP_METHODS.join(', ')}.`
  }
  if (input.body && input.form?.length) {
    return 'Use "body" (a raw payload) or "form" (url-encoded fields), not both.'
  }
  if (
    input.timeoutMs !== undefined &&
    (!Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0)
  ) {
    return '"timeoutMs" must be a positive whole number of milliseconds, e.g. 30000.'
  }
  if (
    input.maxRedirects !== undefined &&
    (!Number.isInteger(input.maxRedirects) || input.maxRedirects <= 0)
  ) {
    return '"maxRedirects" must be a positive whole number, e.g. 5. Use "followRedirects":false to follow none.'
  }
  const authProblem = authFieldProblem(input)
  if (authProblem) return authProblem

  return null
}

function authFieldProblem(input: HttpRequestInput): string | null {
  switch (input.authType) {
    case 'basic':
      if (!input.username?.trim() || !input.password) {
        return 'authType="basic" needs "username" and "password", e.g. {"authType":"basic","username":"ada","password":"${secret:API_PASSWORD}"}.'
      }
      return null
    case 'bearer':
      if (!input.token?.trim()) {
        return 'authType="bearer" needs a "token", e.g. {"authType":"bearer","token":"${secret:GITHUB_TOKEN}"}.'
      }
      return null
    case 'apikey':
      if (!input.apiKeyName?.trim() || !input.apiKeyValue) {
        return 'authType="apikey" needs "apiKeyName" and "apiKeyValue", e.g. {"authType":"apikey","apiKeyName":"X-Api-Key","apiKeyValue":"${secret:OPENAI_KEY}"}.'
      }
      return null
    // No auth asked for, nothing to guard. Named rather than swept into a `default`, so a new
    // auth variant is a compile error here until its required fields are stated.
    case 'none':
    case undefined:
      return null
  }
}

import type { HttpRequestInput } from './http-request-schema'
import { HTTP_METHODS, parseMethod } from './request-spec'
import { isHttpUrl } from './request-url-policy'
import { hasTemplate } from './template'

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

import type { RequestSpec } from './request-spec'
import { redactSpec } from './store'

/** One redacted roster line shared by tool lists, import previews and collection expansion. */
export function describeRequest(request: { name: string; spec: RequestSpec }): string {
  const spec = redactSpec(request.spec)
  const auth = spec.auth.type === 'none' ? '' : ` [auth: ${spec.auth.type}]`
  return `${request.name}: ${spec.method} ${spec.url}${auth}`
}

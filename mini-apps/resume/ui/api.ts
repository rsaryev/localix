import { z } from 'zod'
import { miniAppApiFetch, unwrapMiniAppResponse } from '@localixai/mini-app-sdk/ui/transport'
import { resumeSchema, resumeSummarySchema, type ResumeDocument } from '../shared/schema'
import { revisionRecordSchema } from '../shared/file-contract'
import type { ResumeOperation } from '../shared/operations'

async function request(
  sessionId: string,
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
) {
  const response = await miniAppApiFetch(
    `/rpc/resume${path}?${new URLSearchParams({ sessionId })}`,
    {
      method,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000),
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    },
  )
  return unwrapMiniAppResponse<unknown>(response)
}
export const resumeApi = {
  list: async (sessionId: string, signal?: AbortSignal) =>
    z
      .strictObject({ resumes: z.array(resumeSummarySchema) })
      .parse(await request(sessionId, '', 'GET', undefined, signal)).resumes,
  get: async (sessionId: string, id: string, signal?: AbortSignal) =>
    resumeSchema.parse(await request(sessionId, `/${id}`, 'GET', undefined, signal)),
  create: async (sessionId: string, document: ResumeDocument) =>
    resumeSchema.parse(await request(sessionId, '', 'POST', { document })),
  update: async (sessionId: string, id: string, revision: string, operations: ResumeOperation[]) =>
    resumeSchema.parse(await request(sessionId, `/${id}`, 'PATCH', { revision, operations })),
  duplicate: async (sessionId: string, id: string, title: string) =>
    resumeSchema.parse(await request(sessionId, `/${id}/duplicate`, 'POST', { title })),
  history: async (sessionId: string, id: string) =>
    z
      .array(revisionRecordSchema.omit({ document: true }))
      .parse(await request(sessionId, `/${id}/history`)),
  revision: async (sessionId: string, id: string, revision: string) =>
    revisionRecordSchema.parse(await request(sessionId, `/${id}/history/${revision}`)),
  restore: async (sessionId: string, id: string, revision: string, target: string) =>
    resumeSchema.parse(await request(sessionId, `/${id}/restore`, 'POST', { revision, target })),
  remove: async (sessionId: string, id: string, revision: string) => {
    await request(sessionId, `/${id}`, 'DELETE', { revision })
  },
}

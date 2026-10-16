import { MAX_REQUEST_BODY_BYTES, formatByteLimit } from '@localixai/api/request-limits'
import type { InferResponseType } from 'hono/client'
import { API_BASE_URL, ApiError, apiFailure, apiFetch, type client } from './internal'

/** Result of materializing a dropped/uploaded file into the content-addressed store. */
export interface UploadedMedia {
  /** Content id (`<sha256>.<ext>`) — used as `mediaId` for the viewer + serve path. */
  id: string
  /** Original filename (drives the tab title + extension→viewer routing). */
  name: string
  size: number
  mediaType: string
}

/**
 * Upload a browser `File` into the media store and return its content id. Used by
 * the drag-to-open router: a web drop never exposes an absolute path, so the bytes
 * are materialized here and the matching viewer tab opens by `mediaId` instead.
 *
 * The bytes ride as the raw request body (no multipart overhead); the filename goes
 * in `?name=` so the server can pick the authoritative media type from the extension.
 */
export async function uploadMedia(file: File): Promise<UploadedMedia> {
  // Refused BEFORE the request. The server cannot explain this one: `Bun.serve` rejects an
  // oversized body with a 413 that has an empty body and no content-type (measured, both for a
  // `Content-Length` upload and a chunked one), so `res.status` is all the response carries. A drop
  // that is going to be refused should also not spend minutes uploading first.
  if (file.size > MAX_REQUEST_BODY_BYTES) {
    throw new ApiError(
      `This file is ${formatByteLimit(file.size)} and the limit is ${formatByteLimit(MAX_REQUEST_BODY_BYTES)}.`,
      413,
    )
  }
  const res = await apiFetch(`${API_BASE_URL}/rpc/media?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    // Best-effort hint; the server prefers the filename extension when it's a known type.
    headers: file.type ? { 'Content-Type': file.type } : undefined,
    body: file,
  })
  if (!res.ok) {
    // A 413 can still arrive without the pre-check firing (a proxy with a smaller cap in front of
    // us), and it is the one status whose cause is worth naming rather than reporting as a number.
    if (res.status === 413) {
      throw new ApiError(
        `The server refused this file as too large (over ${formatByteLimit()}).`,
        413,
      )
    }
    // Any other failure may carry the app's error envelope; the reason beats the status. When it
    // does not, `apiFailure` classifies the status rather than handing the person the number —
    // `media upload failed (500)` was one of these, and it went straight into a drop's report.
    const body = (await res.json().catch(() => undefined)) as
      | { error?: { code?: string; message?: string } }
      | string
      | undefined
    const envelope = typeof body === 'object' ? body.error : undefined
    throw apiFailure(
      envelope?.message,
      res.status,
      envelope?.code ?? null,
      typeof body === 'string' ? body : undefined,
    )
  }
  // The request body is raw bytes, which the typed client cannot send, so `res` is a plain
  // Response. Its body is read as the ROUTE's declared answer, and returning that as
  // `UploadedMedia` is the check: a route that changes what it sends stops this compiling.
  return (await res.json()) as InferResponseType<typeof client.rpc.media.$post, 200 | 201>
}

import {
  fetchArchive,
  unsafeEntryIssue,
  type ArchiveFetchPlan,
} from '@rsaryev/llx-plugin/marketplace'
import { InvalidRequestError } from '../../../../lib/domain-errors'
import { fetchHttpClient } from '../ports/http-client'
import { nodeSha256, zipArchiveReader } from '../ports/marketplace-io'

/** A zip the kit has judged: its bytes and the folder in it that is the plugin (`''`: its top). */
export interface JudgedArchive {
  readonly zip: Buffer
  readonly root: string
}

/**
 * An `archive` plugin source downloaded and judged by the kit (`fetchArchive`): `https://` and
 * the blocked hosts on every hop, the size, the `sha256` pin, the extraction limits, the plugin
 * root and every path and link. `fetch` is read when called, so a test's stub is used. A refusal
 * throws with the kit's message; nothing is written here.
 */
export async function judgedArchive(plan: ArchiveFetchPlan): Promise<JudgedArchive> {
  const ports = { http: fetchHttpClient(), sha256: nodeSha256, archive: zipArchiveReader }
  const signal = AbortSignal.timeout(plan.limits.timeoutMs)
  const fetched = await fetchArchive(plan, ports, { signal })
  if ('severity' in fetched)
    throw new InvalidRequestError('plugin_archive_refused', `${plan.url}: ${fetched.message}`)
  const { bytes } = fetched
  return { zip: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), root: fetched.root }
}

/**
 * A zip Localix already holds (a plugin's MCPB bundle) judged like an archive source at its top:
 * an entry that would land outside the folder, a link that leaves it or an entry written through
 * a link refuses it (`unsafeEntryIssue`).
 */
export async function assertSafeZip(zip: Buffer, what: string): Promise<void> {
  const scan = await zipArchiveReader.scan(new Uint8Array(zip), new AbortController().signal)
  const issue =
    'failure' in scan
      ? { message: `The archive cannot be read: ${scan.message}` }
      : unsafeEntryIssue(scan, '')
  if (issue) throw new InvalidRequestError('plugin_archive_refused', `${what}: ${issue.message}`)
}

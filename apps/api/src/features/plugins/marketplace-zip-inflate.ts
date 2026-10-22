import { createInflateRaw } from 'node:zlib'

import { UnprocessableError } from '../../lib/domain-errors'
import type { ZipMember } from './marketplace-zip-scan'

/**
 * The sizes `scanZip` checks are the ones the zip declares, and `unzip` writes whatever a deflate
 * stream inflates to, declared or not. So before `unzip` runs, each deflated entry is inflated
 * here into a byte counter (nothing is kept) and refused the moment it passes its declared size,
 * or when it ends short of it. With every entry held to its declaration, the declared limits
 * bound what lands on disk. A stored entry is copied as is, so its declared size is already exact.
 */

function lies(member: ZipMember, detail: string): UnprocessableError {
  return new UnprocessableError(
    'plugin_archive_too_large',
    `Archive entry ${member.name} declares ${member.bytes} bytes but ${detail}`,
  )
}

/** Inflate one deflated entry, counting; resolves once it matches its declared size. */
function verifyMember(buf: Buffer, member: ZipMember): Promise<void> {
  const input = buf.subarray(member.dataStart, member.dataStart + member.compressedBytes)
  return new Promise((resolve, reject) => {
    const inflate = createInflateRaw()
    let seen = 0
    inflate.on('data', (chunk: Buffer) => {
      seen += chunk.length
      if (seen <= member.bytes) return
      inflate.destroy()
      reject(lies(member, 'inflates to more'))
    })
    inflate.on('error', (err) =>
      reject(
        new UnprocessableError(
          'plugin_archive_invalid',
          `Archive entry ${member.name} does not inflate: ${err.message}`,
        ),
      ),
    )
    inflate.on('end', () =>
      seen === member.bytes ? resolve() : reject(lies(member, `inflates to ${seen}`)),
    )
    inflate.end(input)
  })
}

/** Hold every deflated entry of a scanned zip to the size it declares. */
export async function verifyZipMembers(buf: Buffer, members: ZipMember[]): Promise<void> {
  for (const member of members) if (member.method !== 0) await verifyMember(buf, member)
}

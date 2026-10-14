/**
 * Our own exported request files → RequestSpecs.
 *
 * The round trip that makes repo-shared requests work: `export` writes these, `import` reads them.
 * Routing them through the SAME importer chain as a curl paste means an exported file and a
 * hand-committed one are read by one code path, and a teammate can paste a file's contents into
 * chat and get the same result as pointing at the directory.
 *
 * First in the chain: its sniff is one JSON parse plus one property, and a file we wrote is the
 * payload we can identify with the most certainty. Nothing else can claim it — a HAR has
 * `log.entries`, a spec has `openapi`, and neither has `localixRestRequest`.
 */

import { parseRequestFile } from '../git-sync/format'
import type { ImportedRequest, Importer } from './types'

export function convertLocalixRequest(text: string): ImportedRequest[] | null {
  const file = parseRequestFile(text)
  if (!file) return null
  return [{ name: file.name, spec: file.spec }]
}

export const localixImporter: Importer = {
  id: 'localix-rest',
  name: 'Localix request file',
  convert: convertLocalixRequest,
}

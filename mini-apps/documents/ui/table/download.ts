import { miniAppFiles } from '@localixai/mini-app-sdk/ui/runtime'
import { tableApi } from '../api/tableApi'

function safeName(title: string | undefined, fallback: string): string {
  const base = (title ?? fallback)
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return base.length > 0 ? base : fallback
}

/**
 * Download the full table in a registered format. `formatId` is the exporter id
 * (matched server-side); `extension` names the file. The server streams it with a
 * Content-Disposition attachment header, so a plain navigation to the export URL
 * downloads the whole dataset — never round-tripping rows through the client.
 */
export async function downloadTable(
  tableId: string,
  formatId: string,
  extension: string,
  title?: string,
): Promise<void> {
  const filename = `${safeName(title, tableId)}.${extension}`
  await miniAppFiles.download(tableApi.exportPath(tableId, formatId), filename)
}

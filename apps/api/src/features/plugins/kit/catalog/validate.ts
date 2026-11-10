import { validatePlugin } from '@rsaryev/llx-plugin'
import { diskFiles } from '../ports/files'

/**
 * What `claude plugin validate <dir>` reports for the folder, by the kit, as messages split by
 * severity (`file: message (path)`).
 */
export async function validatePluginFolder(
  dir: string,
): Promise<{ errors: string[]; warnings: string[] }> {
  const report = await validatePlugin({ files: diskFiles(dir) })
  const errors: string[] = []
  const warnings: string[] = []
  for (const found of report.issues) {
    const where = [found.file, found.path].filter((part) => part && part !== '.').join(' ')
    ;(found.severity === 'error' ? errors : warnings).push(
      where ? `${found.message} (${where})` : found.message,
    )
  }
  return { errors, warnings }
}

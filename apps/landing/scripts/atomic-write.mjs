import { promises as fs } from 'node:fs'
import path from 'node:path'

let atomicWriteSequence = 0

/** Replace one generated file atomically. Parallel Turbo tasks may both invoke
 * docs:gen; a direct write or whole-directory rm lets one observe the other's
 * half-written tree. Sibling temp files + rename keep every visible file complete. */
export async function writeFileAtomic(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${atomicWriteSequence++}.tmp`,
  )
  try {
    await fs.writeFile(temp, content, 'utf8')
    await fs.rename(temp, file)
  } finally {
    await fs.rm(temp, { force: true })
  }
}

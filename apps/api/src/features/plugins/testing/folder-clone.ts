import { promises as fs } from 'node:fs'

/**
 * A `cloneRepo` that copies a local folder as if it were the repository, for tests of a marketplace
 * Localix fetches and keeps its own copy of (a local one is read in place instead).
 */
export const folderClone =
  (folder: string) =>
  async (_url: string, dest: string): Promise<void> => {
    await fs.cp(folder, dest, { recursive: true })
  }

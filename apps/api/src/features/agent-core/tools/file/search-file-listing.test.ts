import { expect, test } from 'bun:test'
import { createSearchTool } from './search'
import { localEnvironment } from '../environments/local'
import type { SearchToolDetails } from './search-contracts'

const listingTool = (result: { stdout: string; stderr: string; exitCode: number }) =>
  createSearchTool(
    {
      config: localEnvironment.config,
      readFile: localEnvironment.readFile.bind(localEnvironment),
      writeFile: localEnvironment.writeFile.bind(localEnvironment),
      searchFiles: localEnvironment.searchFiles.bind(localEnvironment),
      exec: async () => result,
    },
    '/fixture',
  )

test('a nonempty listing publishes its details even when the pipeline reports an error', async () => {
  const tool = listingTool({ stdout: 'a.ts\nb.ts\n', stderr: 'partial pipeline', exitCode: 2 })
  const updates: Partial<SearchToolDetails>[] = []
  const result = await tool.execute('listing', { glob: '*.ts' }, undefined, (details) => {
    updates.push(details)
  })
  expect(result.isError).toBeUndefined()
  expect(result.content).toContain('2 files matching glob "*.ts"')
  expect(result.details?.output).toBe('a.ts\nb.ts')
  expect(updates).toHaveLength(1)
  expect(updates[0]).toBe(result.details!)
})

test('an empty listing distinguishes missing ripgrep, glob errors and no matching files', async () => {
  const cases = [
    { stderr: '', exitCode: 127, content: 'ripgrep (rg) is not available', isError: true },
    { stderr: 'ENOENT', exitCode: 0, content: 'ripgrep (rg) is not available', isError: true },
    { stderr: 'invalid glob', exitCode: 0, content: 'glob error: invalid glob', isError: true },
    { stderr: '', exitCode: 2, content: 'glob error: ripgrep failed (exit code 2)', isError: true },
    { stderr: '   ', exitCode: 1, content: 'No files matching glob "*.ts"', isError: undefined },
  ]
  for (const { stderr, exitCode, content, isError } of cases) {
    const updates: Partial<SearchToolDetails>[] = []
    const result = await listingTool({ stdout: ' \n ', stderr, exitCode }).execute(
      'listing',
      { glob: '*.ts' },
      undefined,
      (details) => {
        updates.push(details)
      },
    )
    expect(result.content).toContain(content)
    expect(result.isError).toBe(isError)
    expect(result.details).toBeUndefined()
    expect(updates).toEqual([])
  }
})

test('listing update errors propagate after successful process execution', async () => {
  const failure = new Error('update failed')
  const tool = listingTool({ stdout: 'a.ts', stderr: '', exitCode: 0 })
  const run = tool.execute('listing', { glob: '*.ts' }, undefined, () => {
    throw failure
  })
  await expect(run).rejects.toBe(failure)
})

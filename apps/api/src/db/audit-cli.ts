import { resolveDbFile } from '../lib/env'
import { auditDatabase } from './audit'

const filename = process.argv[2] ?? resolveDbFile()
try {
  const result = await auditDatabase(filename)
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exitCode = 1
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}

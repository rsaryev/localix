import { createHash } from 'node:crypto'
import { agentRecordSchema, type AgentRecord } from './contracts'

/** A repository file may not claim a shipped agent's authority without an authenticated save. */
export const BUILTIN_OVERRIDE_FIELD = 'builtinOverrideHash'
export const builtinOverrideHash = (record: AgentRecord): string =>
  createHash('sha256')
    .update(JSON.stringify(agentRecordSchema.parse(record)))
    .digest('hex')

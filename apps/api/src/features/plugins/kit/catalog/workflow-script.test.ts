import { describe, expect, it } from 'bun:test'

import { workflowScript } from './workflow-script'

describe('workflowScript', () => {
  it('splits a script at the end of its meta literal, as the kit reads it', () => {
    const read = workflowScript(
      "export const meta = { name: 'audit', description: 'Review' };\nreturn 1\n",
    )
    expect(read).toEqual({ name: 'audit', description: 'Review', body: '\nreturn 1\n' })
  })

  it('says why a script whose meta is not a literal cannot be read', () => {
    const read = workflowScript('const x = 1\nexport const meta = { name: x }')
    expect('error' in read && read.error.length > 0).toBe(true)
  })
})

import { describe, expect, test } from 'bun:test'
import { buildExecCommand } from './execCommand'

describe('buildExecCommand', () => {
  test('runs docker exec -it and prefers bash with an sh fallback', () => {
    expect(buildExecCommand('abc123')).toBe(
      `docker exec -it 'abc123' sh -c "command -v bash >/dev/null 2>&1 && exec bash || exec sh"`,
    )
  })

  test('the id is quoted, not spliced — the PTY re-parses this under sh -lc', () => {
    // Today's caller passes a hex id, so this cannot bite yet; the quoting is what keeps
    // that a property of the string rather than of the caller's good manners.
    expect(buildExecCommand(`a'; id #`)).toBe(
      `docker exec -it 'a'\\''; id #' sh -c "command -v bash >/dev/null 2>&1 && exec bash || exec sh"`,
    )
  })
})

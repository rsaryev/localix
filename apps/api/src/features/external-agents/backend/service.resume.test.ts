import { expect, spyOn, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentSessionsService } from './service'
import { adapterFor } from './adapters/registry'

const id = '5f1c0b9e-1111-4222-8333-444455556666'

test('continuation resolves native identity and recorded cwd without reading transcript events', async () => {
  const home = await mkdtemp(join(tmpdir(), 'external-resume-'))
  const directory = join(home, '.claude', 'projects', '-work-app')
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, `${id}.jsonl`),
    `${JSON.stringify({
      type: 'user',
      timestamp: '2026-08-01T10:00:00.000Z',
      sessionId: id,
      cwd: '/work/app',
      message: { role: 'user', content: 'Fix the parser' },
    })}\n`,
  )
  const adapter = adapterFor('claude-code')!
  const transcript = spyOn(adapter, 'readTranscript')
  const service = new AgentSessionsService(join(home, 'state'), () => {}, {
    env: {},
    homeDir: home,
  })
  try {
    expect(await service.resume(`claude-code:${id}`)).toEqual({
      resume: {
        providerName: 'Claude Code',
        command: `cd -- '/work/app' && claude --resume '${id}'`,
      },
    })
    expect(await service.resume('claude-code:missing')).toBeNull()
    expect(await service.resume('invalid')).toBeNull()
    expect(transcript).not.toHaveBeenCalled()
    const unavailable = new AgentSessionsService(
      join(home, 'other-state'),
      () => {},
      { env: {}, homeDir: home },
      () => ['codex'],
    )
    expect(await unavailable.resume(`claude-code:${id}`)).toBeNull()
  } finally {
    transcript.mockRestore()
    await rm(home, { recursive: true, force: true })
  }
})

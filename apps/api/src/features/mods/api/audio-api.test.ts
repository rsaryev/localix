import { expect, test } from 'bun:test'
import { createAudioApi, speechArgv } from './audio-api'

test('speech and clips go to the system’s voice and player', async () => {
  const ran: string[][] = []
  const audio = createAudioApi({
    run: async (argv) => (ran.push(argv), { exitCode: 0 }),
    root: '/plugins/chime',
    download: async (url) => `/tmp/${url.split('/').pop()}`,
    platform: 'darwin',
  })
  expect(await audio.speak('Build done', { voice: 'Samantha' })).toEqual({ via: 'system' })
  await audio.play({ asset: 'sounds/done.wav' })
  await audio.play({ url: 'https://example.com/ping.mp3' })
  expect(ran).toEqual([
    ['say', '-v', 'Samantha', 'Build done'],
    ['afplay', '/plugins/chime/sounds/done.wav'],
    ['afplay', '/tmp/ping.mp3'],
  ])
  expect(speechArgv('hi', undefined, 'linux')).toEqual(['spd-say', '--wait', 'hi'])
  expect(speechArgv("it's", undefined, 'win32').at(-1)).toContain("Speak('it''s')")
})

test('a player that fails rejects with its words', async () => {
  const audio = createAudioApi({
    run: async () => ({ exitCode: 1, stderr: 'no audio device' }),
    root: '/p',
    download: async () => '',
    platform: 'linux',
  })
  await expect(audio.speak('x')).rejects.toThrow('audio.speak: no audio device')
  await expect(audio.play({})).rejects.toThrow('takes an asset')
})

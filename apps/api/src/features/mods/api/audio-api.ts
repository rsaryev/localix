import { join } from 'node:path'

/**
 * `$.audio`, as Claude Code plays it: through the system. `speak` reads text aloud with the
 * system's voice (`say` on macOS, `spd-say` on Linux, the speech synthesizer on Windows) and
 * answers `{ via: 'system' }`; `play` plays a clip the plugin ships (`asset`, under its root), a
 * file or URL, with the system's player.
 */

type Run = (argv: string[]) => Promise<{ exitCode: number; stderr?: string }>

const quoted = (text: string) => `'${text.replaceAll("'", "''")}'`

export function speechArgv(text: string, voice: string | undefined, platform: NodeJS.Platform) {
  if (platform === 'darwin') return ['say', ...(voice ? ['-v', voice] : []), text]
  if (platform === 'win32')
    return [
      'powershell',
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ${voice ? `$s.SelectVoice(${quoted(voice)}); ` : ''}$s.Speak(${quoted(text)})`,
    ]
  return ['spd-say', '--wait', ...(voice ? ['-y', voice] : []), text]
}

export function playerArgv(file: string, platform: NodeJS.Platform) {
  if (platform === 'darwin') return ['afplay', file]
  if (platform === 'win32')
    return [
      'powershell',
      '-NoProfile',
      '-Command',
      `(New-Object Media.SoundPlayer ${quoted(file)}).PlaySync()`,
    ]
  return ['paplay', file]
}

export function createAudioApi(input: {
  run: Run
  root: string
  /** Fetches a clip given by URL to a local file the player can open. */
  download: (url: string) => Promise<string>
  platform?: NodeJS.Platform
}) {
  const platform = input.platform ?? process.platform
  const succeeded = async (argv: string[], what: string) => {
    const result = await input.run(argv)
    if (result.exitCode !== 0)
      throw new Error(`audio.${what}: ${result.stderr?.trim() || argv[0]} failed`)
  }
  return {
    async speak(text: unknown, options?: unknown) {
      if (typeof text !== 'string' || !text.trim()) throw new Error('audio.speak takes a text')
      const voice = (options as { voice?: unknown } | undefined)?.voice
      await succeeded(
        speechArgv(text, typeof voice === 'string' ? voice : undefined, platform),
        'speak',
      )
      return { via: 'system' as const }
    },
    async play(clip: unknown) {
      const given = (clip ?? {}) as { asset?: unknown; url?: unknown; path?: unknown }
      const file =
        typeof given.asset === 'string'
          ? join(input.root, given.asset)
          : typeof given.url === 'string'
            ? await input.download(given.url)
            : typeof given.path === 'string'
              ? given.path
              : null
      if (!file) throw new Error('audio.play takes an asset, a path or a url')
      await succeeded(playerArgv(file, platform), 'play')
    },
  }
}

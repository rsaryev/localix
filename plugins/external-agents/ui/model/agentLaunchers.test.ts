import { describe, expect, test } from 'bun:test'

import { AGENT_LAUNCHERS, AGENT_MARKS, agentLaunchCommand } from './agentLaunchers'
import { detectLaunchKind } from '../../backend/live/launch-kinds'
import { PROVIDER_ADAPTERS } from '../../backend/adapters/registry'

/**
 * The launcher and the observer used to live in two different plugins, so nothing could check that
 * the command one emitted was the command the other recognised. They are one plugin now, which
 * makes the round trip testable for real instead of by reading the other side's source.
 *
 * The failure this catches is silent: the agent launches perfectly, the terminal works, and the
 * session simply never appears in the roster.
 */
describe('agent launchers', () => {
  test('a launched agent is recognised by the observer that watches for it', () => {
    for (const launcher of AGENT_LAUNCHERS) {
      const command = agentLaunchCommand(launcher)
      // The whole point of the hint: the observer must resolve the provider from the command line.
      expect(detectLaunchKind(command)).toBe(launcher.provider)
    }
  })

  test('every launcher names a provider the plugin actually has an adapter for', () => {
    const known = new Set(PROVIDER_ADAPTERS.map((adapter) => adapter.id))
    for (const launcher of AGENT_LAUNCHERS) expect(known.has(launcher.provider)).toBe(true)
    expect(Object.keys(AGENT_MARKS).every((provider) => known.has(provider))).toBe(true)
  })

  test('and every adapter has one, because the other direction fails in silence', () => {
    /**
     * The check above only rejects a launcher for an agent we cannot READ. The reverse — an adapter
     * with no way to LAUNCH it and no icon to recognise it by — passed happily, and its symptom is
     * an absence: no row in the quick-action menu, a blank mark in the roster, and nothing anywhere
     * saying a provider was added and half-wired.
     *
     * The README promises that adding a provider is one descriptor file plus one registry entry.
     * That promise is only kept if the UI derives from the registry or is checked against it.
     */
    const launchable = new Set(AGENT_LAUNCHERS.map((launcher) => launcher.provider))
    const missingLauncher = PROVIDER_ADAPTERS.map((a) => a.id).filter((id) => !launchable.has(id))
    const missingMark = PROVIDER_ADAPTERS.map((a) => a.id).filter((id) => !(id in AGENT_MARKS))

    expect(
      missingLauncher,
      `These adapters have no launcher, so nothing can start them:\n  ${missingLauncher.join(', ')}`,
    ).toEqual([])
    expect(
      missingMark,
      `These adapters have no brand mark, so their roster rows render blank:\n  ${missingMark.join(', ')}`,
    ).toEqual([])
  })

  test('the hint survives the tokenizer that looks for the executable', () => {
    // detectLaunchKind walks tokens and skips NAME=value prefixes. A launcher that put the hint
    // anywhere else would resolve to no provider at all.
    expect(agentLaunchCommand({ provider: 'codex', executable: 'codex' })).toBe(
      'LOCALIX_AGENT=codex codex',
    )
    expect(detectLaunchKind('LOCALIX_AGENT=codex /opt/homebrew/bin/codex --model gpt-5')).toBe(
      'codex',
    )
  })

  test('providers and executables are unique, so one launcher cannot shadow another', () => {
    const providers = AGENT_LAUNCHERS.map((launcher) => launcher.provider)
    const executables = AGENT_LAUNCHERS.map((launcher) => launcher.executable)
    expect(new Set(providers).size).toBe(providers.length)
    expect(new Set(executables).size).toBe(executables.length)
  })

  test('an executable is a bare NAME, never a path or a shell fragment', () => {
    // It is interpolated into a command string that a login shell runs. A name with a space, a
    // quote or a `;` in it would stop being one argument — the probe would also never find it.
    for (const launcher of AGENT_LAUNCHERS) {
      expect(launcher.executable).toMatch(/^[a-z][a-z0-9._-]*$/)
    }
  })
})

/** The scripted coding session the context-window emulation replays: seeded, so identical on every run. */
export const TURNS = 100

/** mulberry32: the script of the session is identical on every run and for every window. */
function seeded(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface ScriptedTurn {
  prompt: string
  calls: { name: 'read' | 'bash' | 'edit'; lines: number }[]
  answer: string
}

export const SCRIPT: ScriptedTurn[] = (() => {
  const rnd = seeded(20260924)
  return Array.from({ length: TURNS }, (_, i) => ({
    prompt: `Task ${i + 1}: continue the importer refactor and report what changed.`,
    calls: Array.from({ length: 2 + Math.floor(rnd() * 3) }, (_, k) => {
      const kind = rnd()
      return kind < 0.55
        ? { name: 'read' as const, lines: 150 + Math.floor(rnd() * 650) }
        : kind < 0.85
          ? { name: 'bash' as const, lines: 40 + Math.floor(rnd() * 160) }
          : { name: 'edit' as const, lines: 30 + k }
    }),
    answer: `Turn ${i + 1}: updated the importer and its tests; ${'details '.repeat(60)}`,
  }))
})()

export const toolCall = (turn: number, k: number, call: ScriptedTurn['calls'][number]) => ({
  type: 'tool_call',
  toolCallId: `t-${turn}-${k}`,
  name: call.name,
  status: 'completed',
  input: { path: `/repo/src/mod-${turn}-${k}.ts`, command: `bun test ${turn}-${k}` },
  resultText: Array.from(
    { length: call.lines },
    (_, line) => `export const v${turn}_${k}_${line} = ${line} // generated filler\n`,
  ).join(''),
})

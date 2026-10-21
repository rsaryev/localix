import { useCallback, useState } from 'react'
import type { ParsedArgChip, SlashArgOption } from '@localixai/api/slash-catalog'

const key = (arg: string, value: string) => `${arg}\0${value}`

/**
 * A dynamic argument's chip shows the label its menu row had (`OpenAI`, not the connection id the
 * prompt carries). The parser only sees tokens, so the composer remembers every row it offered or
 * committed, per argument, and relabels the chips with them.
 */
export function useChipLabels() {
  const [known, setKnown] = useState<ReadonlyMap<string, SlashArgOption>>(() => new Map())
  const remember = useCallback((arg: string, options: readonly SlashArgOption[]) => {
    setKnown((previous) => {
      if (options.every((option) => previous.get(key(arg, option.value)) === option))
        return previous
      const next = new Map(previous)
      for (const option of options) next.set(key(arg, option.value), option)
      return next
    })
  }, [])
  const relabel = useCallback(
    (chips: readonly ParsedArgChip[]) =>
      chips.map((chip) => {
        const option = known.get(key(chip.spec.name, chip.option.value))
        return option ? { ...chip, option } : chip
      }),
    [known],
  )
  return { remember, relabel }
}

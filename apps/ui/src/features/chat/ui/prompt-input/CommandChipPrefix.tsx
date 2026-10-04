import { SquareTerminal } from 'lucide-react'
import type { ComposerCommands } from './useComposerCommands'
import { CommandToken } from './CommandToken'

/**
 * CommandChipPrefix — the composer textarea's leading chip cluster.
 *
 * Renders the active slash-command chip (with a clear button) followed by any
 * selected argument tokens, each individually clearable. The command always
 * uses the command glyph, so provider/skill artwork cannot be mistaken for search.
 * Rendered as the TextArea `prefix` only while a slash command is detected;
 * returns null otherwise so callers can pass it unconditionally.
 */
export function CommandChipPrefix({
  slash,
  slashArgs,
}: Pick<ComposerCommands, 'slash' | 'slashArgs'>) {
  if (!slash.detected) return null

  return (
    <span className="mt-[0.18rem] inline-flex shrink-0 flex-wrap items-center gap-1">
      <CommandToken
        icon={<SquareTerminal className="size-3" />}
        label={`/${slash.detected.command.trigger}`}
        emphasis
        onRemove={slash.clearCommand}
        removeLabel="Clear command"
      />
      {slashArgs.chips.map((chip, i) => (
        <CommandToken
          key={chip.spec.name}
          label={chip.option.label}
          title={`${chip.spec.name}: ${chip.option.label}`}
          onRemove={() => slashArgs.clearArgFrom(i)}
          removeLabel={`Clear ${chip.spec.name}`}
        />
      ))}
    </span>
  )
}

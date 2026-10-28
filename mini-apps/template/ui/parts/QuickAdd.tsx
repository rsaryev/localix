import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { Input } from '@localixai/kit/input'
import type { EntryInput } from '../../shared/model'

/**
 * Log one entry by hand. The answer is the new list, which the screen shows at once; the form
 * clears only when the entry was stored, so a refused one keeps what the person typed.
 */
export function QuickAdd({
  unit,
  sending,
  onAdd,
}: {
  unit: string
  sending: boolean
  onAdd: (input: EntryInput) => Promise<unknown>
}) {
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const value = Number(amount)
  const ready = title.trim() !== '' && amount !== '' && Number.isFinite(value) && value >= 0
  const add = async () => {
    if (await onAdd({ title: title.trim(), amount: value })) {
      setTitle('')
      setAmount('')
    }
  }
  return (
    <form
      aria-label="Add an entry"
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) void add()
      }}
    >
      <Input
        aria-label="What"
        placeholder="What was it?"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        className="min-w-0 flex-1"
      />
      <Input
        aria-label="Amount"
        placeholder={unit}
        inputMode="decimal"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        className="w-24"
      />
      <Button type="submit" variant="secondary" disabled={sending || !ready}>
        <Plus data-icon="inline-start" />
        Add
      </Button>
    </form>
  )
}

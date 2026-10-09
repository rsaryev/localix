/** Number fields commit on blur. A pending invalid local value must not be silently skipped. */
export function validateEditorNumbers(trigger: HTMLElement): boolean {
  const editor = trigger.closest('[data-motion-editor]')
  if (!editor) return true
  for (const input of editor.querySelectorAll<HTMLInputElement>('input[type="number"]')) {
    const value = Number(input.value)
    if (
      !input.value.trim() ||
      !Number.isFinite(value) ||
      (input.min && value < Number(input.min)) ||
      (input.max && value > Number(input.max))
    ) {
      input.focus()
      return false
    }
  }
  return true
}

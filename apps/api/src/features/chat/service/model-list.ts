export function formatModelList(
  models: { id: string; name: string; contextLength?: number }[],
  currentId: string,
): string {
  if (models.length === 0) return 'No models available for this connection.'
  const lines = ['**Available models** (use `/model <name>` to switch):', '']
  for (const m of models.slice(0, 40)) {
    const current = m.id === currentId ? ' ← current' : ''
    const ctx = m.contextLength ? ` · ${Math.round(m.contextLength / 1000)}k ctx` : ''
    lines.push(`- \`${m.name}\`${ctx}${current}`)
  }
  if (models.length > 40) lines.push(`…and ${models.length - 40} more.`)
  return lines.join('\n')
}

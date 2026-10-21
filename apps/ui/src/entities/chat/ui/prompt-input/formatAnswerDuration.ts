/** Compact, stable-width elapsed time for the participant holding the floor. */
export function formatAnswerDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60

  if (hours > 0) return `${hours}h${minutes}m${remainder}sec`
  if (minutes > 0) return `${minutes}m${remainder}sec`
  return `${remainder}sec`
}

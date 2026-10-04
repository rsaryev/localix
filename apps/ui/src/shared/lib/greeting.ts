/**
 * Greeting helpers shared by onboarding and the empty chat (`EmptyState`) so
 * greetings can't drift in wording or in how a name is shortened.
 */

/** Time-of-day greeting (local time). */
export function timeGreeting(date: Date = new Date()): string {
  const h = date.getHours()
  if (h >= 5 && h < 12) return 'Good morning'
  if (h >= 12 && h < 17) return 'Good afternoon'
  if (h >= 17 && h < 22) return 'Good evening'
  return 'Good night'
}

/** First word of a display name (trimmed), or '' — for personalized greetings. */
export function firstNameOf(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? ''
}

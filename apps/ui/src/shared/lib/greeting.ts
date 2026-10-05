/**
 * Greeting helpers shared by onboarding and the empty chat (`EmptyState`) so
 * greetings use the same wording.
 */

/** Time-of-day greeting (local time). */
export function timeGreeting(date: Date = new Date()): string {
  const h = date.getHours()
  if (h >= 5 && h < 12) return 'Good morning'
  if (h >= 12 && h < 17) return 'Good afternoon'
  if (h >= 17 && h < 22) return 'Good evening'
  return 'Good night'
}

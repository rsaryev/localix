/**
 * How the app places a moment for a reader: the calendar day it fell on, and the clock within it.
 *
 * A list that spans days — the transcript, the browser's history — states the day once above its
 * first entry and gives each entry a bare clock. A date on every row repeats itself down the list
 * and still leaves the reader working out where one day ends. Every such list reads its rules
 * from here, so a day called "Yesterday" in one is not "23 September" in the next.
 */

const DAY_MS = 86_400_000

/** Midnight opening `at`'s LOCAL calendar day: the key two moments share when they are one day. */
export function localDayStart(at: Date): number {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()
}

/**
 * "Today", "Yesterday", else the date. A calendar day, not 24 hours: 10pm yesterday is still
 * yesterday at 3pm today.
 */
export function dayLabel(day: Date, now: Date = new Date()): string {
  // Rounded, because a day that moves the clock for daylight saving is 23 or 25 hours long.
  const days = Math.round((localDayStart(now) - localDayStart(day)) / DAY_MS)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  // Within the year the year itself is noise; past that it is the whole point.
  return day.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    ...(day.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
}

/** The wall clock at `at`, hours and minutes, in the reader's locale. */
export function clockTime(at: Date): string {
  return at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

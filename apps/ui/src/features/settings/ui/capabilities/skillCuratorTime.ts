import { formatTimeAgo } from '@localixai/plugin-sdk/ui/utilities'

/**
 * "3d ago"-style relative timestamp for curator facts, with `null` rendered as
 * "never" rather than as a blank.
 *
 * Shared by the active and archived skill rows because they answer the same
 * question about the same clock — a skill that reads "used 4× · last never"
 * beside an archive that reads "archived —" would look like two different
 * records.
 */
export function relativeTime(iso: string | null): string {
  return iso ? formatTimeAgo(Date.parse(iso)) : 'never'
}

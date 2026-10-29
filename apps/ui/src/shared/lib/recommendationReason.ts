import type { RecommendReason } from '@localixai/store'

/**
 * Why a package is recommended, as one line a person reads: the tab, the chip, the installs or
 * the project that found it (`docs/internals/store.md`, "Recommendations").
 */
export function recommendationReason(reason: RecommendReason | undefined): string | undefined {
  if (!reason) return undefined
  const label = reason.label
  switch (reason.source) {
    case 'linked':
      return label ? `Because you linked ${label}` : 'Because of what you linked'
    case 'open':
      return label ? `Because ${label} is open` : 'Because of what is open'
    case 'context':
      return 'Suits what you work on'
    case 'installed':
      return label ? `Because you use ${label}` : 'Like what you installed'
    case 'project':
      return label ? `Suits this project: ${label}` : 'Suits this project'
    case 'trusted':
      return 'A trusted pick'
  }
}

/**
 * What the recommendations are for, short enough for one line above the composer: the file that
 * found them, or what kind of evidence did. The full reason belongs to the Store's list.
 */
export function recommendationFor(reason: RecommendReason | undefined): string {
  switch (reason?.source) {
    case 'linked':
    case 'open':
      return reason.label ? `for ${reason.label}` : 'for your work'
    case 'installed':
      return 'for what you installed'
    case 'project':
      return 'for this project'
    default:
      return 'for your work'
  }
}

import { hasUpdate, isActiveJob, type Listing, type StoreActivity } from '@localixai/store'

/**
 * THE STORE'S ACTIVITY: the jobs in flight and the updates offered, every kind's — mini app
 * installs, plugin installs and removals, plugin updates — from the listings a person has state
 * for. One feed for the Event Center and the update strip.
 */
export function activityOf(listings: readonly Listing[]): StoreActivity {
  const jobs: StoreActivity['jobs'] = []
  const updates: StoreActivity['updates'] = []
  for (const listing of listings) {
    const label = {
      ref: listing.ref,
      displayName: listing.displayName,
      ...(listing.icon ? { icon: listing.icon } : {}),
    }
    if (listing.job && isActiveJob(listing.job))
      jobs.push({
        ...label,
        ...(listing.version ? { version: listing.version } : {}),
        ...listing.job,
      })
    else if (hasUpdate(listing))
      for (const install of listing.installs)
        if (install.updateTo)
          updates.push({
            ...label,
            ...(install.version ? { from: install.version } : {}),
            to: install.updateTo,
          })
  }
  return { jobs, updates }
}

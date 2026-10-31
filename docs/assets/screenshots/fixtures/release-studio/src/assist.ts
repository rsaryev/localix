import { release, type Release } from './release'

/** Where a release goes out, and what can be done with it. */
export const channel = {
  name: 'stable',
  audience: 12_400,
  rolloutPercent: 25,
  paused: false,
  publish(notes: string, target: Release = release): Promise<void> {
    return Promise.resolve(void [notes, target.id])
  },
  pause(reason: string): void { this.paused = !!reason },
  resume(): void { this.paused = false },
  rollBack(to: Release): Release { return to },
  describe(): string { return `${this.name} ${this.audience}` },
}

channel.pause('Waiting for the mobile check')

const text = channel.
  describe()

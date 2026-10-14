import type { WorkItemSlotContribution } from '@localixai/plugin-sdk/ui'
import { usePluginRegistrySlice } from './usePluginRegistrySlice'

const slots: WorkItemSlotContribution[] = []

export function registerWorkItemSlot(contribution: WorkItemSlotContribution): void {
  if (!slots.some((candidate) => candidate.slot === contribution.slot)) slots.push(contribution)
}

/** Drop every slot fill `owner` registered (a plugin reload or unload). */
export function removeWorkItemSlotsOf(owner: string): void {
  for (let index = slots.length - 1; index >= 0; index -= 1) {
    if (slots[index]?.pluginName === owner) slots.splice(index, 1)
  }
}

export function workItemSlot(slot: string): WorkItemSlotContribution | undefined {
  return slots.find((candidate) => candidate.slot === slot)
}

/**
 * Who fills `slot`, re-read when that answer moves. A diff opened before the git plugin had
 * registered read `workItemSlot` once and stayed a read-only diff for the life of the tab.
 */
export function useWorkItemSlot(slot: string): WorkItemSlotContribution | undefined {
  return usePluginRegistrySlice(`slot:${slot}`, () => workItemSlot(slot))
}

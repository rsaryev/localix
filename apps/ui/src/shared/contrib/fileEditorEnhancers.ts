import type { FileEditorEnhancerContribution } from '@localixai/mini-app-sdk/ui'

const enhancers: FileEditorEnhancerContribution[] = []

export function registerFileEditorEnhancer(contribution: FileEditorEnhancerContribution): void {
  if (!enhancers.some((candidate) => candidate.id === contribution.id)) enhancers.push(contribution)
}

/** Drop every enhancer `owner` registered (a mini app reload or unload). */
export function removeFileEditorEnhancersOf(owner: string): void {
  for (let index = enhancers.length - 1; index >= 0; index -= 1) {
    if (enhancers[index]?.miniAppName === owner) enhancers.splice(index, 1)
  }
}

export function fileEditorEnhancersFor(path: string): FileEditorEnhancerContribution[] {
  return enhancers.filter((enhancer) => enhancer.match(path))
}

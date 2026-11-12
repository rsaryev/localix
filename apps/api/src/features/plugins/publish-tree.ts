import { publishExtensionTrees, type ExtensionTreeInput } from './publish-trees'

export { isExtensionPublicationArtifact } from './publish-trees'

export interface ExtensionPublicationLifecycle {
  prepare?: (stagedDirectory: string) => Promise<void>
  commit?: (publishedDirectory: string) => Promise<void>
}

/** Single-tree convenience wrapper; shares locking, staging and recovery with batch publication. */
export async function publishExtensionTree(
  input: ExtensionPublicationLifecycle & ExtensionTreeInput & { installRoot: string },
): Promise<string> {
  const directories = await publishExtensionTrees({
    installRoot: input.installRoot,
    trees: [input],
    commit: input.commit ? async (published) => input.commit!(published[0]!) : undefined,
  })
  return directories[0]!
}

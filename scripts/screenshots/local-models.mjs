import { expect } from '@playwright/test'
import { api, verifyDemoRuntime } from './runtime.mjs'

/**
 * Local models and semantic search captures.
 *
 * Opt-in (`LOCALIX_CAPTURE_LOCAL_MODELS=1`): the isolated API must run with `LOCALIX_MODELS_DIR`
 * pointing at a dedicated folder that already holds the pinned embedding model, so a capture never
 * downloads into, or shows, a person's own model folder. The seed turns semantic search on and
 * waits until the fixture conversation is really indexed: the meaning match below is computed by
 * the model, not drawn.
 */
const EMBEDDING_MODEL = 'ggml-org/embeddinggemma-2-GGUF:Q8_0'
/**
 * Shares only stopwords with the fixture's "The desktop and mobile layouts are ready" — it is
 * found by meaning (measured cosine 0.79, 0.08 clear of the next message).
 */
export const MEANING_QUERY = 'are the screens finished on phones and computers'

export async function seedLocalModels() {
  await verifyDemoRuntime()
  const local = await api('/local-models/status')
  if (!local.installed.some((spec) => spec.id === EMBEDDING_MODEL))
    throw new Error(
      `LOCALIX_MODELS_DIR must already hold ${EMBEDDING_MODEL}; captures never download models.`,
    )
  await api('/semantic/enable', {})
  for (let attempt = 0; attempt < 120; attempt++) {
    const status = await api('/semantic/status')
    if (status.index.phase === 'idle' && status.index.items > 0) return
    if (status.index.phase === 'retrying') throw new Error(status.index.lastError ?? 'index failed')
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('The fixture index did not finish building.')
}

export async function composeLocalModels(page, scenario) {
  if (scenario === 'local-models-settings') {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Models', exact: true }).click()
    await page.getByText('Get models', { exact: true }).waitFor()
    await page
      .getByRole('button', { name: /^Download / })
      .first()
      .waitFor()
    return
  }
  await page.getByRole('button', { name: /^Search — everything across the workspace/ }).click()
  await page.getByRole('textbox', { name: 'Search everything…' }).fill(MEANING_QUERY)
  await page
    .getByText(/desktop and mobile layouts are ready/)
    .first()
    .waitFor()
}

export async function verifyLocalModels(page, scenario) {
  if (scenario === 'local-models-settings') {
    await expect(page.getByText('On this computer', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: /Browse Hugging Face/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Download / }).first()).toBeVisible()
    return
  }
  // The layouts message is found although the query shares none of its words; how it was found
  // is not shown — search is just search.
  await expect(page.getByText(/desktop and mobile layouts are ready/).first()).toBeVisible()
  await expect(page.getByText('Matching words and meaning', { exact: true })).toHaveCount(0)
}

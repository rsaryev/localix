/** Read and page the open ImageLightbox (it portals to the document body). */
export function lightboxPaging(act: (run: () => Promise<void>) => Promise<void>) {
  const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]')
  return {
    /** The name of the image the lightbox shows, or null when it is closed. */
    current: () => dialog()?.querySelector('img')?.getAttribute('alt') ?? null,
    press: (key: 'ArrowLeft' | 'ArrowRight' | 'Escape') =>
      act(async () => {
        dialog()?.dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
        )
      }),
  }
}

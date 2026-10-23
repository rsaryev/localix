declare module 'foliate-js/mobi.js' {
  export function isMOBI(file: Blob): Promise<boolean>
  export class MOBI {
    constructor(options: { unzlib: (bytes: Uint8Array) => Uint8Array })
    open(file: Blob): Promise<unknown>
  }
}

declare module 'pdfjs-dist/legacy/build/pdf.worker.min.mjs' {
  export const WorkerMessageHandler: unknown
}

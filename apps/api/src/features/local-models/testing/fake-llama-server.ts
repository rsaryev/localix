/**
 * A stand-in for `llama-server` in process tests: same flags it is started with, same
 * `/health` and `/v1/embeddings` contract, deterministic vectors. Test-only.
 */
const args = process.argv.slice(2)
const flag = (name: string) => args[args.indexOf(name) + 1]
const port = Number(flag('--port'))
const key = flag('--api-key')
if (args.includes('--crash-on-start')) process.exit(3)

Bun.serve({
  hostname: '127.0.0.1',
  port,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/health') return Response.json({ status: 'ok' })
    if (req.headers.get('authorization') !== `Bearer ${key}`)
      return new Response('unauthorized', { status: 401 })
    const body = (await req.json()) as { input: string[] }
    if (body.input.includes('CRASH')) process.exit(9)
    return Response.json({
      data: body.input.map((text, index) => {
        const v = Array.from({ length: 8 }, (_, i) => ((text.length + i) % 5) + 1)
        const n = Math.hypot(...v)
        return { index, embedding: v.map((x) => x / n) }
      }),
    })
  },
})

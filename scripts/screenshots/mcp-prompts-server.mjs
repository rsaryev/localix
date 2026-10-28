// A tiny MCP server over stdio that offers two prompts and no tools, so the composer's slash menu
// has `/mcp__<server>__<prompt>` rows to show. The capture runtime starts it itself, as it starts any
// stdio server a person adds; nothing here touches the network or a model.
import readline from 'node:readline'

const prompts = [
  {
    name: 'summarize_changes',
    description: 'Summarize what changed since the last release tag',
    arguments: [
      { name: 'tag', description: 'The release tag to compare with', required: true },
      { name: 'focus', description: 'An area to look at first' },
    ],
  },
  {
    name: 'write_release_notes',
    description: 'Draft release notes in the project’s house style',
    arguments: [{ name: 'version', description: 'The version being released', required: true }],
  },
]

const reply = (id, result) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  // Notifications carry no id and are never answered.
  if (message.id === undefined) return
  if (message.method === 'initialize')
    reply(message.id, {
      protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
      capabilities: { prompts: {} },
      serverInfo: { name: 'release-prompts', version: '1.0.0' },
    })
  else if (message.method === 'prompts/list') reply(message.id, { prompts })
  else if (message.method === 'prompts/get')
    reply(message.id, {
      messages: [{ role: 'user', content: { type: 'text', text: `Run ${message.params?.name}.` } }],
    })
  else if (message.method === 'tools/list') reply(message.id, { tools: [] })
  else if (message.method === 'ping') reply(message.id, {})
  else
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } })}\n`,
    )
})

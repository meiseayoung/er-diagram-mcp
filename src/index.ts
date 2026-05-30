import fs from 'node:fs'

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { getMcpAccessState, verifyMcpAccess } from './access.js'
import { parseSQLDDL } from '$er/parsers/sqlParser.js'
import { stageForSync } from './stageForSync.js'
import { createMcpServer } from './server.js'
import { setSchema } from './session.js'

async function runPushCli(): Promise<void> {
  await verifyMcpAccess()
  const access = getMcpAccessState()
  if (!access.granted) {
    console.error(`[er-diagram-mcp] ${access.message}`)
    process.exit(1)
  }

  const sqlArg = process.argv.find((a) => a.endsWith('.sql'))
  if (sqlArg) {
    const sql = fs.readFileSync(sqlArg, 'utf8')
    setSchema(parseSQLDDL(sql, { dialect: 'mysql' }))
  }

  const result = await stageForSync()
  console.log(JSON.stringify(result, null, 2))
  if (result.ok) {
    console.error('[er-diagram-mcp] Staged for editor — choose replace or patch sync in the side panel.')
  }
  process.exit(result.ok ? 0 : 1)
}

async function main(): Promise<void> {
  if (process.argv.includes('--push')) {
    await runPushCli()
    return
  }

  await verifyMcpAccess()
  const access = getMcpAccessState()
  if (!access.granted) {
    console.error(`[er-diagram-mcp] ${access.message}`)
  } else {
    console.error(`[er-diagram-mcp] VIP access OK${access.email ? ` (${access.email})` : ''}`)
  }

  const server = createMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error) => {
  console.error('er-diagram-mcp failed:', error)
  process.exit(1)
})

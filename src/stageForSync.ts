import { resolveApiUrl } from './access.js'
import { getSchema } from './session.js'

export interface StageForSyncResult {
	ok: boolean
	tableCount?: number
	canAppend?: boolean
	message?: string
	error?: string
}

/**
 * Stage current MCP session schema for manual sync in the ER Diagram editor.
 * Does not modify the canvas until the user chooses Replace or Append there.
 */
export async function stageForSync(): Promise<StageForSyncResult> {
	const apiUrl = resolveApiUrl()
	const token = (process.env.ER_DIAGRAM_ACCESS_TOKEN ?? '').trim()
	if (!token) {
		return {
			ok: false,
			error: 'ER_DIAGRAM_ACCESS_TOKEN is not set in IDE MCP config.'
		}
	}

	const schema = getSchema()
	if (!schema.tables?.length) {
		return { ok: false, error: 'MCP session schema is empty. Import or design a schema first.' }
	}

	const res = await fetch(`${apiUrl}/api/mcp/stage`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ schema })
	})

	const body = (await res.json()) as {
		ok?: boolean
		tableCount?: number
		hasPatches?: boolean
		message?: string
		error?: string
	}

	if (!res.ok) {
		return { ok: false, error: body.error ?? `HTTP ${res.status}` }
	}

	return {
		ok: true,
		tableCount: body.tableCount,
		canAppend: body.canAppend,
		message: body.message
	}
}

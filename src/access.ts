export interface McpAccessState {
	granted: boolean
	message: string
	email?: string
	role?: string
}

let state: McpAccessState = {
	granted: false,
	message: 'MCP access not verified yet.'
}

export function getMcpAccessState(): McpAccessState {
	return state
}

export function resolveApiUrl(): string {
	const raw = (process.env.ER_DIAGRAM_API_URL ?? 'http://localhost:5173').trim()
	try {
		return new URL(raw).origin
	} catch {
		return 'http://localhost:5173'
	}
}

/**
 * Verify VIP MCP entitlement against the app API.
 * Requires ER_DIAGRAM_ACCESS_TOKEN (session JWT from GET /api/mcp/token).
 */
export async function verifyMcpAccess(): Promise<McpAccessState> {
	const apiUrl = resolveApiUrl()
	const token = (process.env.ER_DIAGRAM_ACCESS_TOKEN ?? '').trim()

	if (!token) {
		state = {
			granted: false,
			message:
				'MCP requires an active VIP subscription. Set ER_DIAGRAM_ACCESS_TOKEN in your IDE MCP config — copy the token from the ER Diagram editor (VIP account → MCP setup).'
		}
		return state
	}

	try {
		const res = await fetch(`${apiUrl}/api/mcp/verify`, {
			headers: { Authorization: `Bearer ${token}` }
		})
		const body = (await res.json()) as {
			allowed?: boolean
			reason?: string
			email?: string
			role?: string
		}

		if (!res.ok || !body.allowed) {
			const reason = body.reason ?? (res.status === 401 ? 'INVALID_SESSION' : 'MCP_VIP_REQUIRED')
			state = {
				granted: false,
				message:
					reason === 'MCP_VIP_REQUIRED'
						? 'MCP is a VIP-only feature. Upgrade at the pricing page, then refresh your access token in IDE MCP settings.'
						: 'Invalid or expired MCP access token. Sign in as a VIP user in the editor and copy a new token from MCP setup.'
			}
			return state
		}

		state = {
			granted: true,
			message: 'VIP MCP access verified.',
			email: body.email,
			role: body.role
		}
		return state
	} catch (err) {
		state = {
			granted: false,
			message: `Could not reach ER Diagram API at ${apiUrl}. Start the app or set ER_DIAGRAM_API_URL. ${err instanceof Error ? err.message : String(err)}`
		}
		return state
	}
}

export function assertMcpAccess(): { content: Array<{ type: 'text'; text: string }> } | null {
	if (state.granted) return null
	return {
		content: [{ type: 'text', text: state.message }]
	}
}

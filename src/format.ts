export function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function toolText(parts: string[]): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text', text: parts.filter(Boolean).join('\n\n') }]
  }
}

export function parseSchemaJson(input: string, label: string): unknown {
  try {
    return JSON.parse(input) as unknown
  } catch {
    throw new Error(`${label} must be valid JSON`)
  }
}

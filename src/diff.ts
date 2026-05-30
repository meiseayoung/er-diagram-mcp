import { diffSchemas, type DiffChange, type DiffResult } from './diffCompare.js'

export { diffSchemas }
export type { DiffResult, DiffChange }

export function describeDiffChanges(diff: DiffResult): string[] {
  return diff.changes.map((change) => describeChange(change))
}

function describeChange(change: DiffChange): string {
  const name = change.name ?? change.id
  const category = change.category
  switch (change.type) {
    case 'added':
      return `[+] ${category} "${name}"`
    case 'removed':
      return `[-] ${category} "${name}"`
    case 'modified':
      return `[~] ${category} "${name}" (${change.changedFields?.join(', ') ?? 'fields changed'})`
  }
}

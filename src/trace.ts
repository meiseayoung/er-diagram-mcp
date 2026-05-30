import type { ERDiagramData, ERRelation } from '$er/types.js'

export interface TraceNode {
  tableId: string
  tableName: string
  column?: string
  relationId?: string
  relationType?: string
  direction: 'outgoing' | 'incoming'
}

export interface TraceResult {
  start: { tableId: string; tableName: string; column?: string }
  depth: number
  nodes: TraceNode[]
}

function resolveTable(
  data: ERDiagramData,
  opts: { tableId?: string; tableName?: string }
): { id: string; name: string } | null {
  if (opts.tableId) {
    const t = data.tables.find((x) => x.id === opts.tableId)
    return t ? { id: t.id, name: t.name } : null
  }
  if (opts.tableName) {
    const t = data.tables.find((x) => x.name === opts.tableName)
    return t ? { id: t.id, name: t.name } : null
  }
  return null
}

function relationMatchesColumn(rel: ERRelation, tableId: string, column?: string): boolean {
  if (!column) return rel.fromTableId === tableId || rel.toTableId === tableId
  return (
    (rel.fromTableId === tableId && rel.fromColumn === column) ||
    (rel.toTableId === tableId && rel.toColumn === column)
  )
}

export function traceRelations(
  data: ERDiagramData,
  opts: {
    tableId?: string
    tableName?: string
    column?: string
    depth?: number
    direction?: 'both' | 'outgoing' | 'incoming'
  }
): TraceResult | { error: string } {
  const start = resolveTable(data, opts)
  if (!start) {
    return { error: 'Table not found (provide tableId or tableName)' }
  }

  const maxDepth = Math.min(Math.max(opts.depth ?? 1, 1), 5)
  const direction = opts.direction ?? 'both'
  const nodes: TraceNode[] = []
  const seen = new Set<string>()

  type Frontier = { tableId: string; column?: string; depth: number }
  let frontier: Frontier[] = [{ tableId: start.id, column: opts.column, depth: 0 }]

  while (frontier.length > 0) {
    const next: Frontier[] = []

    for (const { tableId, column, depth } of frontier) {
      if (depth >= maxDepth) continue

      for (const rel of data.relations) {
        if (!relationMatchesColumn(rel, tableId, column)) continue

        const key = `${rel.id}:${tableId}:${depth}`
        if (seen.has(key)) continue
        seen.add(key)

        const from = data.tables.find((t) => t.id === rel.fromTableId)
        const to = data.tables.find((t) => t.id === rel.toTableId)
        if (!from || !to) continue

        if (rel.fromTableId === tableId && (direction === 'both' || direction === 'outgoing')) {
          nodes.push({
            tableId: to.id,
            tableName: to.name,
            column: rel.toColumn,
            relationId: rel.id,
            relationType: rel.type,
            direction: 'outgoing'
          })
          if (depth + 1 < maxDepth) {
            next.push({ tableId: to.id, column: rel.toColumn, depth: depth + 1 })
          }
        }

        if (rel.toTableId === tableId && (direction === 'both' || direction === 'incoming')) {
          nodes.push({
            tableId: from.id,
            tableName: from.name,
            column: rel.fromColumn,
            relationId: rel.id,
            relationType: rel.type,
            direction: 'incoming'
          })
          if (depth + 1 < maxDepth) {
            next.push({ tableId: from.id, column: rel.fromColumn, depth: depth + 1 })
          }
        }
      }
    }

    frontier = next
  }

  return {
    start: { tableId: start.id, tableName: start.name, column: opts.column },
    depth: maxDepth,
    nodes
  }
}

import type { ERDiagramData } from '$er/types.js'

export type DiffChangeType = 'added' | 'modified' | 'removed'

export interface ColumnChange {
  type: 'added' | 'removed' | 'modified' | 'renamed'
  columnName: string
  oldColumnName?: string
  changedFields?: string[]
  before?: unknown
  after?: unknown
}

export interface IndexChange {
  type: 'added' | 'removed' | 'modified'
  indexName: string
  changedFields?: string[]
  before?: unknown
  after?: unknown
}

export interface DiffChange {
  type: DiffChangeType
  category: 'table' | 'relation' | 'group' | 'annotation'
  id: string
  name?: string
  before?: unknown
  after?: unknown
  changedFields?: string[]
  columnChanges?: ColumnChange[]
  indexChanges?: IndexChange[]
}

export interface DiffResult {
  fromSnapshotId: string
  toSnapshotId: string
  timestamp: number
  changes: DiffChange[]
  summary: { added: number; modified: number; removed: number }
}

function findFieldChanges(a: Record<string, unknown>, b: Record<string, unknown>, skip: string[]): string[] {
  const fields: string[] = []
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of allKeys) {
    if (skip.includes(key)) continue
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) fields.push(key)
  }
  return fields
}

function diffColumns(fromCols: Record<string, unknown>[], toCols: Record<string, unknown>[]): ColumnChange[] {
  const changes: ColumnChange[] = []
  const fromByName = new Map(fromCols.map((c) => [c.name as string, c]))
  const toByName = new Map(toCols.map((c) => [c.name as string, c]))
  const matchedFrom = new Set<string>()
  const matchedTo = new Set<string>()

  fromByName.forEach((fromCol, name) => {
    const toCol = toByName.get(name)
    if (!toCol) return
    matchedFrom.add(name)
    matchedTo.add(name)
    const colChanged = findFieldChanges(fromCol, toCol, ['name'])
    if (colChanged.length > 0) {
      changes.push({ type: 'modified', columnName: name, changedFields: colChanged, before: fromCol, after: toCol })
    }
  })

  const unmatchedFrom = fromCols.filter((c) => !matchedFrom.has(c.name as string))
  const unmatchedTo = toCols.filter((c) => !matchedTo.has(c.name as string))
  const renamedFrom = new Set<string>()
  const renamedTo = new Set<string>()

  for (const fromCol of unmatchedFrom) {
    if (renamedFrom.has(fromCol.name as string)) continue
    let bestMatch: Record<string, unknown> | null = null
    let bestScore = 0
    for (const toCol of unmatchedTo) {
      if (renamedTo.has(toCol.name as string)) continue
      let score = 0
      if (fromCol.type === toCol.type) score += 3
      if (fromCol.isPrimaryKey === toCol.isPrimaryKey) score += 1
      if (fromCol.isForeignKey === toCol.isForeignKey) score += 1
      const fromIdx = fromCols.indexOf(fromCol)
      const toIdx = toCols.indexOf(toCol)
      if (Math.abs(fromIdx - toIdx) <= 1) score += 2
      if (score > bestScore && score >= 3) {
        bestScore = score
        bestMatch = toCol
      }
    }
    if (bestMatch) {
      renamedFrom.add(fromCol.name as string)
      renamedTo.add(bestMatch.name as string)
      const colChanged = findFieldChanges(fromCol, bestMatch, ['name'])
      changes.push({
        type: 'renamed',
        columnName: bestMatch.name as string,
        oldColumnName: fromCol.name as string,
        changedFields: colChanged.length > 0 ? colChanged : undefined,
        before: fromCol,
        after: bestMatch
      })
    }
  }

  for (const fromCol of unmatchedFrom) {
    if (renamedFrom.has(fromCol.name as string)) continue
    changes.push({ type: 'removed', columnName: fromCol.name as string, before: fromCol })
  }
  for (const toCol of unmatchedTo) {
    if (renamedTo.has(toCol.name as string)) continue
    changes.push({ type: 'added', columnName: toCol.name as string, after: toCol })
  }

  return changes
}

function diffIndexes(fromIndexes: Record<string, unknown>[], toIndexes: Record<string, unknown>[]): IndexChange[] {
  const changes: IndexChange[] = []
  const fromByName = new Map(fromIndexes.map((idx) => [idx.name as string, idx]))
  const toByName = new Map(toIndexes.map((idx) => [idx.name as string, idx]))

  toByName.forEach((idx, name) => {
    if (!fromByName.has(name)) changes.push({ type: 'added', indexName: name, after: idx })
  })
  fromByName.forEach((idx, name) => {
    if (!toByName.has(name)) changes.push({ type: 'removed', indexName: name, before: idx })
  })
  fromByName.forEach((fromIdx, name) => {
    const toIdx = toByName.get(name)
    if (!toIdx) return
    const changedFields = findFieldChanges(fromIdx, toIdx, ['name'])
    if (changedFields.length > 0) {
      changes.push({ type: 'modified', indexName: name, changedFields, before: fromIdx, after: toIdx })
    }
  })
  return changes
}

function diffEntities(
  fromList: Array<{ id: string; name?: string; [k: string]: unknown }>,
  toList: Array<{ id: string; name?: string; [k: string]: unknown }>,
  category: DiffChange['category'],
  changes: DiffChange[]
): void {
  const fromMap = new Map(fromList.map((item) => [item.id, item]))
  const toMap = new Map(toList.map((item) => [item.id, item]))

  toMap.forEach((item, id) => {
    if (!fromMap.has(id)) {
      changes.push({ type: 'added', category, id, name: item.name as string | undefined, after: item })
    }
  })

  fromMap.forEach((item, id) => {
    if (!toMap.has(id)) {
      changes.push({ type: 'removed', category, id, name: item.name as string | undefined, before: item })
    }
  })

  fromMap.forEach((fromItem, id) => {
    const toItem = toMap.get(id)
    if (!toItem) return
    const changedFields = findFieldChanges(fromItem, toItem, ['id'])
    if (changedFields.length === 0) return

    const change: DiffChange = {
      type: 'modified',
      category,
      id,
      name: (toItem.name ?? fromItem.name) as string | undefined,
      before: fromItem,
      after: toItem,
      changedFields
    }

    if (category === 'table' && changedFields.includes('columns')) {
      change.columnChanges = diffColumns(
        (fromItem.columns as Record<string, unknown>[]) || [],
        (toItem.columns as Record<string, unknown>[]) || []
      )
    }
    if (category === 'table' && changedFields.includes('indexes')) {
      change.indexChanges = diffIndexes(
        (fromItem.indexes as Record<string, unknown>[]) || [],
        (toItem.indexes as Record<string, unknown>[]) || []
      )
    }
    changes.push(change)
  })
}

export function diffSchemas(from: ERDiagramData, to: ERDiagramData): DiffResult {
  const changes: DiffChange[] = []
  diffEntities(from.tables, to.tables, 'table', changes)
  diffEntities(from.relations, to.relations, 'relation', changes)
  diffEntities(from.groups ?? [], to.groups ?? [], 'group', changes)
  diffEntities(from.annotations ?? [], to.annotations ?? [], 'annotation', changes)

  return {
    fromSnapshotId: 'from',
    toSnapshotId: 'to',
    timestamp: Date.now(),
    changes,
    summary: {
      added: changes.filter((c) => c.type === 'added').length,
      modified: changes.filter((c) => c.type === 'modified').length,
      removed: changes.filter((c) => c.type === 'removed').length
    }
  }
}

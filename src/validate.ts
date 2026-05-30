import type { ERDiagramData, ERRelation, ERTable } from '$er/types.js'

export type ValidationSeverity = 'error' | 'warning' | 'info'

export interface ValidationIssue {
  severity: ValidationSeverity
  code: string
  message: string
  tableId?: string
  relationId?: string
}

export interface ValidationResult {
  valid: boolean
  issues: ValidationIssue[]
}

function tableById(tables: ERTable[], id: string): ERTable | undefined {
  return tables.find((t) => t.id === id)
}

function columnExists(table: ERTable, name: string): boolean {
  return table.columns.some((c) => c.name === name)
}

function checkRelation(
  rel: ERRelation,
  tables: ERTable[],
  issues: ValidationIssue[]
): void {
  const parent = tableById(tables, rel.fromTableId)
  const child = tableById(tables, rel.toTableId)

  if (!parent) {
    issues.push({
      severity: 'error',
      code: 'RELATION_UNKNOWN_FROM_TABLE',
      message: `Relation ${rel.id}: fromTableId "${rel.fromTableId}" does not exist`,
      relationId: rel.id
    })
  }
  if (!child) {
    issues.push({
      severity: 'error',
      code: 'RELATION_UNKNOWN_TO_TABLE',
      message: `Relation ${rel.id}: toTableId "${rel.toTableId}" does not exist`,
      relationId: rel.id
    })
  }
  if (parent && !columnExists(parent, rel.fromColumn)) {
    issues.push({
      severity: 'error',
      code: 'RELATION_UNKNOWN_FROM_COLUMN',
      message: `Relation ${rel.id}: fromColumn "${rel.fromColumn}" not found on ${parent.name}`,
      relationId: rel.id,
      tableId: parent.id
    })
  }
  if (child && !columnExists(child, rel.toColumn)) {
    issues.push({
      severity: 'error',
      code: 'RELATION_UNKNOWN_TO_COLUMN',
      message: `Relation ${rel.id}: toColumn "${rel.toColumn}" not found on ${child.name}`,
      relationId: rel.id,
      tableId: child.id
    })
  }
}

export function validateSchema(data: ERDiagramData): ValidationResult {
  const issues: ValidationIssue[] = []
  const tableIds = new Set<string>()
  const tableNames = new Set<string>()

  if (data.tables.length === 0) {
    issues.push({
      severity: 'warning',
      code: 'EMPTY_SCHEMA',
      message: 'Schema has no tables'
    })
  }

  for (const table of data.tables) {
    if (tableIds.has(table.id)) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_TABLE_ID',
        message: `Duplicate table id: ${table.id}`,
        tableId: table.id
      })
    }
    tableIds.add(table.id)

    if (tableNames.has(table.name)) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_TABLE_NAME',
        message: `Duplicate table name: ${table.name}`,
        tableId: table.id
      })
    }
    tableNames.add(table.name)

    if (!table.name?.trim()) {
      issues.push({
        severity: 'error',
        code: 'EMPTY_TABLE_NAME',
        message: `Table ${table.id} has an empty name`,
        tableId: table.id
      })
    }

    if (table.columns.length === 0) {
      issues.push({
        severity: 'warning',
        code: 'TABLE_NO_COLUMNS',
        message: `Table "${table.name}" has no columns`,
        tableId: table.id
      })
    }

    const colNames = new Set<string>()
    let pkCount = 0
    for (const col of table.columns) {
      if (colNames.has(col.name)) {
        issues.push({
          severity: 'error',
          code: 'DUPLICATE_COLUMN_NAME',
          message: `Table "${table.name}": duplicate column "${col.name}"`,
          tableId: table.id
        })
      }
      colNames.add(col.name)
      if (col.isPrimaryKey) pkCount++
    }

    if (table.columns.length > 0 && pkCount === 0) {
      issues.push({
        severity: 'warning',
        code: 'TABLE_NO_PRIMARY_KEY',
        message: `Table "${table.name}" has no primary key column`,
        tableId: table.id
      })
    }
  }

  const relationIds = new Set<string>()
  for (const rel of data.relations) {
    if (relationIds.has(rel.id)) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_RELATION_ID',
        message: `Duplicate relation id: ${rel.id}`,
        relationId: rel.id
      })
    }
    relationIds.add(rel.id)
    checkRelation(rel, data.tables, issues)
  }

  return {
    valid: !issues.some((i) => i.severity === 'error'),
    issues
  }
}

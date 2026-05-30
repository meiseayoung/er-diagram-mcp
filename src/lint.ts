import type { ERDiagramData } from '$er/types.js'
import type { ValidationIssue } from './validate.js'

const SNAKE_CASE = /^[a-z][a-z0-9_]*$/

export function lintSchema(data: ERDiagramData): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  for (const table of data.tables) {
    if (!SNAKE_CASE.test(table.name)) {
      issues.push({
        severity: 'info',
        code: 'LINT_TABLE_NAME',
        message: `Table "${table.name}" is not snake_case (recommended: lowercase letters, digits, underscores)`,
        tableId: table.id
      })
    }

    for (const col of table.columns) {
      if (!SNAKE_CASE.test(col.name)) {
        issues.push({
          severity: 'info',
          code: 'LINT_COLUMN_NAME',
          message: `Column "${table.name}.${col.name}" is not snake_case`,
          tableId: table.id
        })
      }

      if (col.isForeignKey && !col.isPrimaryKey) {
        const hasIndex = table.indexes?.some((idx) =>
          idx.columns.some((c) => c.name === col.name)
        )
        if (!hasIndex) {
          issues.push({
            severity: 'info',
            code: 'LINT_FK_NO_INDEX',
            message: `Foreign key column "${table.name}.${col.name}" has no explicit index (may affect join performance)`,
            tableId: table.id
          })
        }
      }
    }
  }

  for (const rel of data.relations) {
    if (rel.virtual) continue
    const child = data.tables.find((t) => t.id === rel.toTableId)
    const col = child?.columns.find((c) => c.name === rel.toColumn)
    if (col && !col.isForeignKey) {
      issues.push({
        severity: 'warning',
        code: 'LINT_FK_FLAG_MISMATCH',
        message: `Relation ${rel.id}: column "${child?.name}.${rel.toColumn}" should have isForeignKey: true`,
        tableId: child?.id,
        relationId: rel.id
      })
    }
  }

  return issues
}

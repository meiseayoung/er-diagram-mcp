import { gridLayout } from '$er/layout/gridLayout.js'
import { parseSQLDDL, type ParseSQLDDLOptions } from '$er/parsers/sqlParser.js'
import type { ERDiagramData } from '$er/types.js'

import { lintSchema } from './lint.js'
import { validateSchema } from './validate.js'

export interface NormalizeFromDdlResult {
  schema: ERDiagramData
  validation: ReturnType<typeof validateSchema>
  lint: ReturnType<typeof lintSchema>
}

/** Ensure stable ids and FK flags after SQL import (no auto-layout tool; grid only for positions). */
export function normalizeFromDdl(
  sql: string,
  options: ParseSQLDDLOptions = {}
): NormalizeFromDdlResult {
  const parsed = parseSQLDDL(sql, options)
  const schema = structuredClone(parsed)

  for (const table of schema.tables) {
    if (!table.id?.trim()) {
      table.id = table.name
    }
  }

  syncForeignKeyFlags(schema)

  const positions = gridLayout(schema.tables)
  for (const table of schema.tables) {
    const pos = positions.get(table.id)
    if (pos) {
      table.x = pos.x
      table.y = pos.y
    }
  }

  const validation = validateSchema(schema)
  const lint = lintSchema(schema)

  return { schema, validation, lint }
}

function syncForeignKeyFlags(data: ERDiagramData): void {
  for (const rel of data.relations) {
    if (rel.virtual) continue
    const child = data.tables.find((t) => t.id === rel.toTableId)
    const col = child?.columns.find((c) => c.name === rel.toColumn)
    if (col) col.isForeignKey = true
  }
}

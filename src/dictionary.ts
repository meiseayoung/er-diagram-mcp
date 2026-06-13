import type { ERColumn, ERDiagramData, ERTable } from '$er/types.js'

export type DictionaryFormat = 'markdown' | 'json' | 'csv' | 'html'

export interface DictionaryColumnEntry {
  column: string
  type: string
  nullable: boolean
  primaryKey: boolean
  foreignKey: boolean
  unique: boolean
  autoIncrement: boolean
  defaultValue: string | null
  references: string | null
  comment: string
}

export interface DictionaryTableEntry {
  table: string
  comment: string
  columns: DictionaryColumnEntry[]
  indexes: Array<{ name: string; type: string; columns: string[]; comment: string }>
}

export interface DataDictionary {
  generatedAt: string
  tableCount: number
  columnCount: number
  tables: DictionaryTableEntry[]
}

function columnType(col: ERColumn): string {
  let type = col.type ?? ''
  if (col.length != null && !/\(/.test(type)) {
    type = `${type}(${col.length})`
  }
  if (col.enumValues?.length && /enum|set/i.test(col.type ?? '')) {
    type = `${col.type}(${col.enumValues.map((v) => `'${v}'`).join(', ')})`
  }
  const flags: string[] = []
  if (col.unsigned) flags.push('UNSIGNED')
  if (col.zerofill) flags.push('ZEROFILL')
  return [type, ...flags].filter(Boolean).join(' ')
}

/** Resolve the parent table.column a foreign key column points to, if any. */
function referenceFor(
  data: ERDiagramData,
  table: ERTable,
  col: ERColumn
): string | null {
  for (const rel of data.relations) {
    if (rel.toTableId !== table.id) continue
    const childCols = rel.toColumns?.length ? rel.toColumns : [rel.toColumn]
    const idx = childCols.indexOf(col.name)
    if (idx === -1) continue
    const parent = data.tables.find((t) => t.id === rel.fromTableId)
    if (!parent) continue
    const parentCols = rel.fromColumns?.length ? rel.fromColumns : [rel.fromColumn]
    const parentCol = parentCols[idx] ?? parentCols[0]
    return `${parent.name}.${parentCol}`
  }
  return null
}

export function buildDataDictionary(data: ERDiagramData): DataDictionary {
  let columnCount = 0
  const tables: DictionaryTableEntry[] = data.tables.map((table) => {
    columnCount += table.columns.length
    return {
      table: table.name,
      comment: table.comment ?? '',
      columns: table.columns.map((col) => ({
        column: col.name,
        type: columnType(col),
        nullable: col.isNullable ?? false,
        primaryKey: col.isPrimaryKey ?? false,
        foreignKey: col.isForeignKey ?? false,
        unique: col.isUnique ?? false,
        autoIncrement: col.isAutoIncrement ?? false,
        defaultValue: col.defaultValue ?? null,
        references: referenceFor(data, table, col),
        comment: col.comment ?? ''
      })),
      indexes: (table.indexes ?? []).map((idx) => ({
        name: idx.name,
        type: idx.type,
        columns: idx.columns.map((c) => c.name),
        comment: idx.comment ?? ''
      }))
    }
  })

  return {
    generatedAt: new Date().toISOString(),
    tableCount: tables.length,
    columnCount,
    tables
  }
}

function yesNo(value: boolean): string {
  return value ? 'Yes' : ''
}

function mdEscape(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function renderMarkdown(dict: DataDictionary): string {
  const out: string[] = []
  out.push('# Data Dictionary')
  out.push('')
  out.push(`Generated: ${dict.generatedAt}`)
  out.push('')
  out.push(`Tables: ${dict.tableCount} · Columns: ${dict.columnCount}`)
  out.push('')

  for (const table of dict.tables) {
    out.push(`## ${table.table}`)
    if (table.comment) {
      out.push('')
      out.push(`> ${mdEscape(table.comment)}`)
    }
    out.push('')
    out.push('| Column | Type | Null | Key | Default | References | Comment |')
    out.push('| --- | --- | --- | --- | --- | --- | --- |')
    for (const col of table.columns) {
      const keys: string[] = []
      if (col.primaryKey) keys.push('PK')
      if (col.foreignKey) keys.push('FK')
      if (col.unique) keys.push('UQ')
      if (col.autoIncrement) keys.push('AI')
      out.push(
        `| ${mdEscape(col.column)} | ${mdEscape(col.type)} | ${col.nullable ? 'Yes' : 'No'} | ${keys.join(', ')} | ${col.defaultValue != null ? mdEscape(col.defaultValue) : ''} | ${col.references ? mdEscape(col.references) : ''} | ${mdEscape(col.comment)} |`
      )
    }
    if (table.indexes.length) {
      out.push('')
      out.push('**Indexes**')
      out.push('')
      out.push('| Name | Type | Columns | Comment |')
      out.push('| --- | --- | --- | --- |')
      for (const idx of table.indexes) {
        out.push(
          `| ${mdEscape(idx.name)} | ${idx.type} | ${mdEscape(idx.columns.join(', '))} | ${mdEscape(idx.comment)} |`
        )
      }
    }
    out.push('')
  }
  return out.join('\n').trimEnd()
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function renderCsv(dict: DataDictionary): string {
  const rows: string[] = []
  rows.push(
    [
      'table',
      'column',
      'type',
      'nullable',
      'primary_key',
      'foreign_key',
      'unique',
      'auto_increment',
      'default',
      'references',
      'comment'
    ].join(',')
  )
  for (const table of dict.tables) {
    for (const col of table.columns) {
      rows.push(
        [
          table.table,
          col.column,
          col.type,
          yesNo(col.nullable),
          yesNo(col.primaryKey),
          yesNo(col.foreignKey),
          yesNo(col.unique),
          yesNo(col.autoIncrement),
          col.defaultValue ?? '',
          col.references ?? '',
          col.comment
        ]
          .map((v) => csvCell(String(v)))
          .join(',')
      )
    }
  }
  return rows.join('\n')
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function renderHtml(dict: DataDictionary): string {
  const out: string[] = []
  out.push('<!doctype html>')
  out.push('<html lang="en"><head><meta charset="utf-8"><title>Data Dictionary</title>')
  out.push(
    '<style>body{font-family:system-ui,sans-serif;margin:24px;color:#1f2937}table{border-collapse:collapse;width:100%;margin-bottom:24px}th,td{border:1px solid #d1d5db;padding:6px 10px;text-align:left;font-size:14px}th{background:#f3f4f6}h2{margin-top:32px}.muted{color:#6b7280}</style>'
  )
  out.push('</head><body>')
  out.push('<h1>Data Dictionary</h1>')
  out.push(
    `<p class="muted">Generated: ${htmlEscape(dict.generatedAt)} · Tables: ${dict.tableCount} · Columns: ${dict.columnCount}</p>`
  )
  for (const table of dict.tables) {
    out.push(`<h2>${htmlEscape(table.table)}</h2>`)
    if (table.comment) out.push(`<p class="muted">${htmlEscape(table.comment)}</p>`)
    out.push('<table><thead><tr>')
    out.push(
      '<th>Column</th><th>Type</th><th>Null</th><th>Key</th><th>Default</th><th>References</th><th>Comment</th>'
    )
    out.push('</tr></thead><tbody>')
    for (const col of table.columns) {
      const keys: string[] = []
      if (col.primaryKey) keys.push('PK')
      if (col.foreignKey) keys.push('FK')
      if (col.unique) keys.push('UQ')
      if (col.autoIncrement) keys.push('AI')
      out.push(
        `<tr><td>${htmlEscape(col.column)}</td><td>${htmlEscape(col.type)}</td><td>${col.nullable ? 'Yes' : 'No'}</td><td>${keys.join(', ')}</td><td>${col.defaultValue != null ? htmlEscape(col.defaultValue) : ''}</td><td>${col.references ? htmlEscape(col.references) : ''}</td><td>${htmlEscape(col.comment)}</td></tr>`
      )
    }
    out.push('</tbody></table>')
  }
  out.push('</body></html>')
  return out.join('\n')
}

export function renderDataDictionary(
  data: ERDiagramData,
  format: DictionaryFormat
): string {
  const dict = buildDataDictionary(data)
  switch (format) {
    case 'json':
      return JSON.stringify(dict, null, 2)
    case 'csv':
      return renderCsv(dict)
    case 'html':
      return renderHtml(dict)
    case 'markdown':
    default:
      return renderMarkdown(dict)
  }
}

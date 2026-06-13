import type { ERColumn, ERDiagramData, ERTable } from '$er/types.js'
import type { SqlDialect } from '$er/parsers/sqlParseShared.js'

export type MockFormat = 'sql' | 'json'

export interface MockDataOptions {
  /** Rows to generate per table (default 10). */
  rows?: number
  /** Output format (default 'sql'). */
  format?: MockFormat
  /** SQL dialect for INSERT quoting (default 'mysql'). */
  dialect?: SqlDialect
  /** Seed for deterministic output (default 1). */
  seed?: number
  /** Only generate for these table names/ids (default: all). */
  tables?: string[]
}

/** Small deterministic PRNG (mulberry32) so output is reproducible per seed. */
function createRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FIRST_NAMES = [
  'Alice', 'Bob', 'Carol', 'David', 'Eve', 'Frank', 'Grace', 'Heidi',
  'Ivan', 'Judy', 'Mallory', 'Niaj', 'Olivia', 'Peggy', 'Sybil', 'Trent'
]
const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller',
  'Davis', 'Martinez', 'Lopez', 'Wilson', 'Anderson', 'Taylor', 'Moore'
]
const WORDS = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing',
  'elit', 'sed', 'tempor', 'incididunt', 'labore', 'magna', 'aliqua'
]
const CITIES = ['New York', 'London', 'Tokyo', 'Paris', 'Berlin', 'Sydney', 'Toronto']
const COMPANIES = ['Acme', 'Globex', 'Initech', 'Umbrella', 'Soylent', 'Hooli']

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min
}

function words(rng: () => number, count: number): string {
  return Array.from({ length: count }, () => pick(rng, WORDS)).join(' ')
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

function randomDate(rng: () => number): string {
  const year = randInt(rng, 2018, 2025)
  const month = randInt(rng, 1, 12)
  const day = randInt(rng, 1, 28)
  return `${year}-${pad(month)}-${pad(day)}`
}

function randomDateTime(rng: () => number): string {
  return `${randomDate(rng)} ${pad(randInt(rng, 0, 23))}:${pad(randInt(rng, 0, 59))}:${pad(randInt(rng, 0, 59))}`
}

interface TypeInfo {
  base: string
  length?: number
}

function parseType(type: string): TypeInfo {
  const match = /^(\w+)\s*(?:\(\s*(\d+))?/.exec(type ?? '')
  return {
    base: (match?.[1] ?? type ?? '').toLowerCase(),
    length: match?.[2] ? Number(match[2]) : undefined
  }
}

/**
 * Generate a raw JS value for a column, using name heuristics first and then
 * falling back to the SQL type. `index` keeps sequential ids/uniques distinct.
 */
function valueForColumn(
  col: ERColumn,
  index: number,
  rng: () => number
): string | number | boolean | null {
  const name = col.name.toLowerCase()
  const { base, length } = parseType(col.type ?? '')

  // Enums always honour the declared set.
  if (col.enumValues?.length) {
    return pick(rng, col.enumValues)
  }

  // Auto-increment / primary integer keys → sequential ids.
  if (col.isAutoIncrement || (col.isPrimaryKey && /int/.test(base))) {
    return index + 1
  }

  // Name-based heuristics.
  if (/(^|_)id$/.test(name) && /int/.test(base)) return index + 1
  if (name === 'uuid' || name.endsWith('_uuid') || /char\(36\)|uuid/.test(base)) {
    return uuidLike(rng)
  }
  if (name.includes('email')) {
    return `${pick(rng, FIRST_NAMES).toLowerCase()}.${index + 1}@example.com`
  }
  if (name.includes('first_name') || name === 'firstname') return pick(rng, FIRST_NAMES)
  if (name.includes('last_name') || name === 'lastname') return pick(rng, LAST_NAMES)
  if (name.includes('username') || name === 'login') {
    return `${pick(rng, FIRST_NAMES).toLowerCase()}${index + 1}`
  }
  if (name === 'name' || name.endsWith('_name')) {
    return `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`
  }
  if (name.includes('phone') || name.includes('mobile') || name.includes('tel')) {
    return `+1${randInt(rng, 200, 999)}${randInt(rng, 1000000, 9999999)}`
  }
  if (name.includes('url') || name.includes('website') || name.includes('link')) {
    return `https://example.com/${pick(rng, WORDS)}/${index + 1}`
  }
  if (name.includes('avatar') || name.includes('image') || name.includes('photo')) {
    return `https://example.com/img/${index + 1}.png`
  }
  if (name.includes('city')) return pick(rng, CITIES)
  if (name.includes('company') || name.includes('org')) return pick(rng, COMPANIES)
  if (name.includes('address')) {
    return `${randInt(rng, 1, 9999)} ${pick(rng, LAST_NAMES)} St, ${pick(rng, CITIES)}`
  }
  if (name.includes('price') || name.includes('amount') || name.includes('cost') || name.includes('total')) {
    return Number((rng() * 1000).toFixed(2))
  }
  if (name.includes('age')) return randInt(rng, 18, 80)
  if (name.includes('count') || name.includes('quantity') || name.includes('qty') || name.includes('stock')) {
    return randInt(rng, 0, 1000)
  }
  if (/^is_|^has_|_flag$/.test(name) || name.includes('enabled') || name.includes('active')) {
    return rng() > 0.5
  }
  if (name.includes('created_at') || name.includes('updated_at') || name.includes('timestamp')) {
    return randomDateTime(rng)
  }
  if (name.includes('description') || name.includes('content') || name.includes('body') || name.includes('comment')) {
    return words(rng, randInt(rng, 6, 14))
  }
  if (name === 'title' || name.endsWith('_title')) {
    return words(rng, randInt(rng, 2, 5))
  }
  if (name.includes('status')) return pick(rng, ['active', 'pending', 'inactive', 'archived'])
  if (name.includes('slug')) return `${pick(rng, WORDS)}-${index + 1}`
  if (name.includes('color')) return `#${randInt(rng, 0, 0xffffff).toString(16).padStart(6, '0')}`

  // Type-based fallback.
  if (/^(tinyint)$/.test(base) && (length === 1 || col.length === 1)) {
    return rng() > 0.5
  }
  if (/^(bool|boolean)$/.test(base)) return rng() > 0.5
  if (/(big|small|medium|tiny)?int|serial/.test(base)) return randInt(rng, 1, 100000)
  if (/(decimal|numeric|float|double|real)/.test(base)) {
    return Number((rng() * 10000).toFixed(2))
  }
  if (/(datetime|timestamp)/.test(base)) return randomDateTime(rng)
  if (/date/.test(base)) return randomDate(rng)
  if (/time/.test(base)) return `${pad(randInt(rng, 0, 23))}:${pad(randInt(rng, 0, 59))}:${pad(randInt(rng, 0, 59))}`
  if (/year/.test(base)) return randInt(rng, 1990, 2025)
  if (/json/.test(base)) return JSON.stringify({ key: pick(rng, WORDS), value: randInt(rng, 1, 100) })
  if (/(text|blob|clob)/.test(base)) return words(rng, randInt(rng, 8, 20))
  if (/(char|varchar|string)/.test(base)) {
    const max = length ?? col.length ?? 32
    let val = words(rng, randInt(rng, 1, 4))
    if (val.length > max) val = val.slice(0, max)
    return val
  }
  if (/(uuid|uniqueidentifier)/.test(base)) return uuidLike(rng)

  // Unknown type → short token.
  return `${pick(rng, WORDS)}_${index + 1}`
}

function uuidLike(rng: () => number): string {
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(rng() * 16).toString(16)).join('')
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${hex(4)}-${hex(12)}`
}

function quoteValue(
  value: string | number | boolean | null,
  dialect: SqlDialect
): string {
  if (value === null) return 'NULL'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') {
    return dialect === 'postgresql' ? (value ? 'TRUE' : 'FALSE') : value ? '1' : '0'
  }
  return `'${value.replace(/'/g, "''")}'`
}

function quoteIdent(name: string, dialect: SqlDialect): string {
  return dialect === 'postgresql' ? `"${name}"` : `\`${name}\``
}

/** Order tables so parents (referenced by FK) come before children. */
function topoSortTables(data: ERDiagramData, tables: ERTable[]): ERTable[] {
  const byId = new Map(tables.map((t) => [t.id, t]))
  const deps = new Map<string, Set<string>>()
  for (const t of tables) deps.set(t.id, new Set())
  for (const rel of data.relations) {
    if (rel.virtual) continue
    // child (toTableId) depends on parent (fromTableId)
    if (byId.has(rel.toTableId) && byId.has(rel.fromTableId) && rel.toTableId !== rel.fromTableId) {
      deps.get(rel.toTableId)!.add(rel.fromTableId)
    }
  }
  const result: ERTable[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const visit = (id: string) => {
    if (visited.has(id) || visiting.has(id)) return
    visiting.add(id)
    for (const dep of deps.get(id) ?? []) visit(dep)
    visiting.delete(id)
    visited.add(id)
    const t = byId.get(id)
    if (t) result.push(t)
  }
  for (const t of tables) visit(t.id)
  return result
}

export interface MockDataResult {
  output: string
  format: MockFormat
  rowsPerTable: number
  tables: string[]
}

export function generateMockData(
  data: ERDiagramData,
  options: MockDataOptions = {}
): MockDataResult {
  const rows = Math.max(1, Math.min(options.rows ?? 10, 1000))
  const format = options.format ?? 'sql'
  const dialect = options.dialect ?? 'mysql'
  const rng = createRng(options.seed ?? 1)

  let selected = data.tables
  if (options.tables?.length) {
    const wanted = new Set(options.tables)
    selected = data.tables.filter((t) => wanted.has(t.name) || wanted.has(t.id))
  }

  const ordered = topoSortTables(data, selected)

  // Generated values keyed by tableId → columnName → value[] (for FK reuse).
  const generated = new Map<string, Map<string, Array<string | number | boolean | null>>>()
  // Full row sets per table for output.
  const tableRows = new Map<string, Array<Record<string, string | number | boolean | null>>>()

  for (const table of ordered) {
    const colValues = new Map<string, Array<string | number | boolean | null>>()
    const rowsOut: Array<Record<string, string | number | boolean | null>> = []

    // Map each FK column on this table to its parent (tableId, parentColumn).
    const fkMap = new Map<string, { parentId: string; parentCol: string }>()
    for (const rel of data.relations) {
      if (rel.virtual || rel.toTableId !== table.id) continue
      const childCols = rel.toColumns?.length ? rel.toColumns : [rel.toColumn]
      const parentCols = rel.fromColumns?.length ? rel.fromColumns : [rel.fromColumn]
      childCols.forEach((c, i) => {
        fkMap.set(c, { parentId: rel.fromTableId, parentCol: parentCols[i] ?? parentCols[0] })
      })
    }

    for (let i = 0; i < rows; i++) {
      const row: Record<string, string | number | boolean | null> = {}
      for (const col of table.columns) {
        let value: string | number | boolean | null

        const fk = fkMap.get(col.name)
        if (fk) {
          // Reference an existing parent value to preserve integrity.
          const parentVals = generated.get(fk.parentId)?.get(fk.parentCol)
          if (parentVals?.length) {
            value = parentVals[randInt(rng, 0, parentVals.length - 1)]
          } else {
            value = col.isNullable ? null : valueForColumn(col, i, rng)
          }
        } else if (col.isNullable && !col.isPrimaryKey && rng() < 0.1) {
          // Occasional NULLs for nullable, non-key columns.
          value = null
        } else {
          value = valueForColumn(col, i, rng)
        }

        row[col.name] = value
        if (!colValues.has(col.name)) colValues.set(col.name, [])
        colValues.get(col.name)!.push(value)
      }
      rowsOut.push(row)
    }

    generated.set(table.id, colValues)
    tableRows.set(table.id, rowsOut)
  }

  let output: string
  if (format === 'json') {
    const obj: Record<string, Array<Record<string, unknown>>> = {}
    for (const table of ordered) {
      obj[table.name] = tableRows.get(table.id) ?? []
    }
    output = JSON.stringify(obj, null, 2)
  } else {
    const blocks: string[] = []
    for (const table of ordered) {
      const rowsOut = tableRows.get(table.id) ?? []
      if (!rowsOut.length || !table.columns.length) continue
      const cols = table.columns.map((c) => c.name)
      const colList = cols.map((c) => quoteIdent(c, dialect)).join(', ')
      const lines = rowsOut.map((row) => {
        const vals = cols.map((c) => quoteValue(row[c] ?? null, dialect)).join(', ')
        return `  (${vals})`
      })
      blocks.push(
        `INSERT INTO ${quoteIdent(table.name, dialect)} (${colList}) VALUES\n${lines.join(',\n')};`
      )
    }
    output = blocks.join('\n\n')
  }

  return {
    output,
    format,
    rowsPerTable: rows,
    tables: ordered.map((t) => t.name)
  }
}

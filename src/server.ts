import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { parseDBML, generateDBML } from '$er/parsers/dbmlParser.js'
import { parseSQLDDL, generateSQLDDL } from '$er/parsers/sqlParser.js'
import type { ERDiagramData } from '$er/types.js'
import type { SqlDialect } from '$er/parsers/sqlParseShared.js'

import { assertMcpAccess } from './access.js'
import { diffSchemas, describeDiffChanges } from './diff.js'
import { renderDataDictionary } from './dictionary.js'
import { jsonText, parseSchemaJson, toolText } from './format.js'
import { lintSchema } from './lint.js'
import { generateMockData } from './mockData.js'
import { normalizeFromDdl } from './normalize.js'
import { applyPatches, type PatchOperation } from './patch.js'
import { stageForSync } from './stageForSync.js'
import { getSchema, setSchema } from './session.js'
import { traceRelations } from './trace.js'
import { validateSchema } from './validate.js'

const dialectSchema = z.enum(['mysql', 'postgresql']).default('mysql')

const erDiagramDataSchema = z.object({
  tables: z.array(z.record(z.unknown())),
  relations: z.array(z.record(z.unknown())),
  groups: z.array(z.record(z.unknown())).optional(),
  annotations: z.array(z.record(z.unknown())).optional(),
  viewport: z.record(z.unknown()).optional()
})

type ToolTextResult = { content: Array<{ type: 'text'; text: string }> }

function guardTool<Args>(
  handler: (args: Args) => ToolTextResult | Promise<ToolTextResult>
): (args: Args) => Promise<ToolTextResult> {
  return async (args: Args) => {
    const denied = assertMcpAccess()
    if (denied) return denied
    return handler(args)
  }
}

type PromptResult = {
  messages: Array<{ role: 'user'; content: { type: 'text'; text: string } }>
}

function guardPrompt<Args>(
  handler: (args: Args) => PromptResult
): (args: Args) => Promise<PromptResult> {
  return async (args: Args) => {
    const denied = assertMcpAccess()
    if (denied) {
      return {
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: denied.content[0]?.text ?? 'MCP VIP access required.' }
          }
        ]
      }
    }
    return handler(args)
  }
}

function asDiagramData(value: unknown): ERDiagramData {
  const parsed = erDiagramDataSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`Invalid ERDiagramData: ${parsed.error.message}`)
  }
  return parsed.data as unknown as ERDiagramData
}

export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'er-diagram',
      version: '0.1.0'
    },
    {
      instructions: [
        'Local ER Diagram MCP (VIP-only): design and mutate database schemas as ERDiagramData JSON.',
        'Requires ER_DIAGRAM_ACCESS_TOKEN from GET /api/mcp/token (active VIP subscription).',
        'Workflow: set_schema or import_sql → patch_schema → validate_schema → export_sql → stage_for_sync.',
        'Also: export_dictionary (data dictionary docs) and generate_mock_data (FK-aware sample rows).',
        'Prompts: design_schema, review_migration, normalize_from_ddl.',
        'stage_for_sync stages only. User applies in editor: replace=overwrite, patch=append (SQL import append). Never auto-apply.',
        'Session schema is exposed as resource er://schema/current.'
      ].join(' ')
    }
  )

  server.registerResource(
    'current-schema',
    'er://schema/current',
    {
      title: 'Current ER schema',
      description: 'In-memory ERDiagramData for this MCP session',
      mimeType: 'application/json'
    },
    async () => {
      const denied = assertMcpAccess()
      if (denied) {
        return {
          contents: [
            {
              uri: 'er://schema/current',
              mimeType: 'text/plain',
              text: denied.content[0]?.text ?? 'MCP VIP access required.'
            }
          ]
        }
      }
      return {
        contents: [
          {
            uri: 'er://schema/current',
            mimeType: 'application/json',
            text: jsonText(getSchema())
          }
        ]
      }
    }
  )

  server.registerTool(
    'get_schema',
    {
      description: 'Return the current in-memory ERDiagramData JSON for this MCP session.'
    },
    guardTool(async () => toolText([jsonText(getSchema())]))
  )

  server.registerTool(
    'set_schema',
    {
      description: 'Replace the session schema with a full ERDiagramData object.',
      inputSchema: {
        schema: z.string().describe('ERDiagramData as JSON string')
      }
    },
    guardTool(async ({ schema }) => {
      const data = asDiagramData(parseSchemaJson(schema, 'schema'))
      setSchema(data)
      const validation = validateSchema(data)
      return toolText([
        'Schema updated.',
        `Tables: ${data.tables.length}, Relations: ${data.relations.length}`,
        `Valid: ${validation.valid}`,
        validation.issues.length ? jsonText(validation.issues) : ''
      ])
    })
  )

  server.registerTool(
    'import_sql',
    {
      description: 'Parse SQL DDL into ERDiagramData and store it in the session.',
      inputSchema: {
        sql: z.string(),
        dialect: dialectSchema.optional()
      }
    },
    guardTool(async ({ sql, dialect }) => {
      const data = parseSQLDDL(sql, { dialect: dialect ?? 'mysql' })
      setSchema(data)
      return toolText([
        'Imported SQL into session.',
        `Tables: ${data.tables.length}, Relations: ${data.relations.length}`,
        jsonText(data)
      ])
    })
  )

  server.registerTool(
    'import_dbml',
    {
      description: 'Parse DBML into ERDiagramData and store it in the session.',
      inputSchema: {
        dbml: z.string()
      }
    },
    guardTool(async ({ dbml }) => {
      const data = parseDBML(dbml)
      setSchema(data)
      return toolText([
        'Imported DBML into session.',
        `Tables: ${data.tables.length}, Relations: ${data.relations.length}`,
        jsonText(data)
      ])
    })
  )

  server.registerTool(
    'export_sql',
    {
      description: 'Generate SQL DDL from the session schema (or optional schema JSON).',
      inputSchema: {
        dialect: dialectSchema.optional(),
        schema: z
          .string()
          .optional()
          .describe('Optional ERDiagramData JSON; defaults to session schema')
      }
    },
    guardTool(async ({ dialect, schema }) => {
      const data = schema
        ? asDiagramData(parseSchemaJson(schema, 'schema'))
        : getSchema()
      const sql = generateSQLDDL(data, (dialect ?? 'mysql') as SqlDialect)
      return toolText([sql])
    })
  )

  server.registerTool(
    'export_dbml',
    {
      description: 'Generate DBML from the session schema (or optional schema JSON).',
      inputSchema: {
        schema: z.string().optional()
      }
    },
    guardTool(async ({ schema }) => {
      const data = schema
        ? asDiagramData(parseSchemaJson(schema, 'schema'))
        : getSchema()
      return toolText([generateDBML(data)])
    })
  )

  server.registerTool(
    'export_dictionary',
    {
      description:
        'Generate a data dictionary (table/column documentation) from the session schema or optional schema JSON.',
      inputSchema: {
        format: z
          .enum(['markdown', 'json', 'csv', 'html'])
          .default('markdown')
          .optional()
          .describe('Output format (default markdown)'),
        schema: z
          .string()
          .optional()
          .describe('Optional ERDiagramData JSON; defaults to session schema')
      }
    },
    guardTool(async ({ format, schema }) => {
      const data = schema
        ? asDiagramData(parseSchemaJson(schema, 'schema'))
        : getSchema()
      return toolText([renderDataDictionary(data, format ?? 'markdown')])
    })
  )

  server.registerTool(
    'generate_mock_data',
    {
      description:
        'Generate realistic mock/sample rows for the session schema (or optional schema JSON). Respects foreign keys for referential integrity.',
      inputSchema: {
        rows: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe('Rows per table (default 10, max 1000)'),
        format: z
          .enum(['sql', 'json'])
          .optional()
          .describe('Output format: sql INSERT statements or json (default sql)'),
        dialect: dialectSchema.optional(),
        seed: z
          .number()
          .int()
          .optional()
          .describe('Seed for deterministic output (default 1)'),
        tables: z
          .array(z.string())
          .optional()
          .describe('Limit to these table names or ids (default all)'),
        schema: z
          .string()
          .optional()
          .describe('Optional ERDiagramData JSON; defaults to session schema')
      }
    },
    guardTool(async ({ rows, format, dialect, seed, tables, schema }) => {
      const data = schema
        ? asDiagramData(parseSchemaJson(schema, 'schema'))
        : getSchema()
      const result = generateMockData(data, {
        rows,
        format: format ?? 'sql',
        dialect: (dialect ?? 'mysql') as SqlDialect,
        seed,
        tables
      })
      return toolText([
        `Generated ${result.rowsPerTable} row(s) for ${result.tables.length} table(s) [${result.format}].`,
        result.output || '(no tables to generate)'
      ])
    })
  )

  server.registerTool(
    'patch_schema',
    {
      description:
        'Apply incremental operations to the session schema (add/remove tables, columns, relations).',
      inputSchema: {
        operations: z
          .array(z.record(z.unknown()))
          .describe('Array of patch operations (see README)')
      }
    },
    guardTool(async ({ operations }) => {
      const result = applyPatches(operations as PatchOperation[])
      const validation = validateSchema(result.schema)
      return toolText([
        `Applied ${result.applied} operation(s).`,
        result.errors.length ? `Errors:\n${result.errors.join('\n')}` : '',
        `Valid: ${validation.valid}`,
        jsonText(result.schema)
      ])
    })
  )

  server.registerTool(
    'validate_schema',
    {
      description: 'Validate structural integrity of a schema (session or JSON input).',
      inputSchema: {
        schema: z.string().optional()
      }
    },
    guardTool(async ({ schema }) => {
      const data = schema
        ? asDiagramData(parseSchemaJson(schema, 'schema'))
        : getSchema()
      const validation = validateSchema(data)
      const lint = lintSchema(data)
      return toolText([
        `Valid: ${validation.valid}`,
        jsonText({ validation, lint })
      ])
    })
  )

  server.registerTool(
    'list_tables',
    {
      description: 'List tables in the session schema with column counts.',
      inputSchema: {
        schema: z.string().optional()
      }
    },
    guardTool(async ({ schema }) => {
      const data = schema
        ? asDiagramData(parseSchemaJson(schema, 'schema'))
        : getSchema()
      const rows = data.tables.map((t) => ({
        id: t.id,
        name: t.name,
        columns: t.columns.length,
        relations: data.relations.filter(
          (r) => r.fromTableId === t.id || r.toTableId === t.id
        ).length
      }))
      return toolText([jsonText(rows)])
    })
  )

  server.registerTool(
    'get_table',
    {
      description: 'Get one table by id or name, including columns and related relations.',
      inputSchema: {
        tableId: z.string().optional(),
        tableName: z.string().optional(),
        schema: z.string().optional()
      }
    },
    guardTool(async ({ tableId, tableName, schema }) => {
      const data = schema
        ? asDiagramData(parseSchemaJson(schema, 'schema'))
        : getSchema()
      const table = tableId
        ? data.tables.find((t) => t.id === tableId)
        : data.tables.find((t) => t.name === tableName)
      if (!table) {
        return toolText(['Table not found.'])
      }
      const relations = data.relations.filter(
        (r) => r.fromTableId === table.id || r.toTableId === table.id
      )
      return toolText([jsonText({ table, relations })])
    })
  )

  server.registerTool(
    'trace_relations',
    {
      description: 'Traverse foreign-key relations from a table (and optional column).',
      inputSchema: {
        tableId: z.string().optional(),
        tableName: z.string().optional(),
        column: z.string().optional(),
        depth: z.number().int().min(1).max(5).optional(),
        direction: z.enum(['both', 'outgoing', 'incoming']).optional(),
        schema: z.string().optional()
      }
    },
    guardTool(async (args) => {
      const data = args.schema
        ? asDiagramData(parseSchemaJson(args.schema, 'schema'))
        : getSchema()
      const result = traceRelations(data, args)
      if ('error' in result) {
        return toolText([result.error])
      }
      return toolText([jsonText(result)])
    })
  )

  server.registerTool(
    'diff_schemas',
    {
      description: 'Structural diff between two ERDiagramData versions (from → to).',
      inputSchema: {
        from_schema: z.string().describe('Base ERDiagramData JSON'),
        to_schema: z.string().describe('Target ERDiagramData JSON')
      }
    },
    guardTool(async ({ from_schema, to_schema }) => {
      const from = asDiagramData(parseSchemaJson(from_schema, 'from_schema'))
      const to = asDiagramData(parseSchemaJson(to_schema, 'to_schema'))
      const diff = diffSchemas(from, to)
      const lines = describeDiffChanges(diff)
      return toolText([
        `Summary: +${diff.summary.added} ~${diff.summary.modified} -${diff.summary.removed}`,
        lines.length ? lines.join('\n') : 'No changes.',
        jsonText(diff)
      ])
    })
  )

  server.registerTool(
    'normalize_from_ddl',
    {
      description:
        'Parse SQL DDL, assign grid positions, sync FK flags, validate and lint; updates session schema.',
      inputSchema: {
        sql: z.string(),
        dialect: dialectSchema.optional()
      }
    },
    guardTool(async ({ sql, dialect }) => {
      const { schema, validation, lint } = normalizeFromDdl(sql, {
        dialect: dialect ?? 'mysql'
      })
      setSchema(schema)
      return toolText([
        'Normalized DDL and updated session.',
        `Tables: ${schema.tables.length}, Relations: ${schema.relations.length}`,
        `Valid: ${validation.valid}`,
        jsonText({ validation, lint, schema })
      ])
    })
  )

  server.registerTool(
    'stage_for_sync',
    {
      description:
        'Stage MCP session schema for manual editor sync. User chooses Replace (overwrite) or Append (SQL import append) in the editor side panel.',
      inputSchema: {}
    },
    guardTool(async () => {
      const result = await stageForSync()
      if (!result.ok) {
        return toolText([`Stage failed: ${result.error ?? 'unknown error'}`])
      }
      return toolText([
        result.message ?? 'Staged for editor sync.',
        `tables: ${result.tableCount ?? 0}`,
        'Tell the user to open the editor: Replace sync or Append to canvas.'
      ])
    })
  )

  server.registerTool(
    'push_to_canvas',
    {
      description: 'Deprecated alias for stage_for_sync (no direct canvas write).',
      inputSchema: {}
    },
    guardTool(async () => {
      const result = await stageForSync()
      if (!result.ok) {
        return toolText([`Stage failed: ${result.error ?? 'unknown error'}`])
      }
      return toolText([
        '(push_to_canvas is deprecated — use stage_for_sync)',
        result.message ?? 'Staged. Apply sync manually in the editor.',
        `tables: ${result.tableCount ?? 0}`
      ])
    })
  )

  registerPrompts(server)

  return server
}

function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'design_schema',
    {
      description: 'Guide the model to design a new database schema from requirements.',
      argsSchema: {
        requirements: z.string().describe('Functional requirements for the data model'),
        domain: z
          .string()
          .optional()
          .describe('Business domain, e.g. e-commerce, SaaS billing'),
        dialect: dialectSchema.optional()
      }
    },
    guardPrompt(async ({ requirements, domain, dialect }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Design a database schema for ER Diagram (ERDiagramData JSON).',
              '',
              `Requirements:\n${requirements}`,
              domain ? `\nDomain: ${domain}` : '',
              `\nTarget SQL dialect: ${dialect ?? 'mysql'}`,
              '',
              'Steps:',
              '1. Propose tables with primary keys, foreign keys, and indexes where needed.',
              '2. Build the model with set_schema or a series of patch_schema operations.',
              '3. Run validate_schema and fix every error before finishing.',
              '4. Run export_sql to produce final DDL.',
              '5. stage_for_sync — user picks Replace (overwrite) or Append (SQL append) in the editor (do not auto-sync).',
              '',
              'Conventions:',
              '- snake_case for table and column names',
              '- Every table must have a primary key',
              '- Set isForeignKey: true on FK columns; use relation type 1:N unless 1:1 is required',
              '- Prefer explicit table ids equal to table names',
              '',
              'Use MCP tools only (no auto_layout). Position tables with reasonable x/y if using patch_schema.'
            ].join('\n')
          }
        }
      ]
    }))
  )

  server.registerPrompt(
    'review_migration',
    {
      description: 'Guide migration risk review between two schema versions.',
      argsSchema: {
        from_schema: z.string().describe('Base ERDiagramData JSON'),
        to_schema: z.string().describe('Target ERDiagramData JSON')
      }
    },
    guardPrompt(async ({ from_schema, to_schema }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Review a database schema migration for breaking changes and operational risk.',
              '',
              'Steps:',
              '1. Call diff_schemas with the from_schema and to_schema below.',
              '2. Classify changes: safe, caution, breaking (data loss, type narrowing, NOT NULL without default, dropped FKs).',
              '3. Estimate risk: low / medium / high with brief justification.',
              '4. Suggest migration order (tables, columns, indexes, FKs) and rollback notes.',
              '',
              'from_schema:',
              from_schema,
              '',
              'to_schema:',
              to_schema
            ].join('\n')
          }
        }
      ]
    }))
  )

  server.registerPrompt(
    'normalize_from_ddl',
    {
      description: 'Guide cleaning and normalizing imported SQL DDL into session schema.',
      argsSchema: {
        sql: z.string().describe('SQL DDL to import'),
        dialect: dialectSchema.optional()
      }
    },
    guardPrompt(async ({ sql, dialect }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Normalize imported SQL DDL into a clean ER Diagram model.',
              '',
              'Steps:',
              `1. Call normalize_from_ddl with the SQL below (dialect: ${dialect ?? 'mysql'}).`,
              '2. Review validation errors and lint warnings; fix with patch_schema if needed.',
              '3. Call validate_schema again until valid.',
              '4. Call export_sql when satisfied.',
              '',
              'SQL:',
              sql
            ].join('\n')
          }
        }
      ]
    }))
  )
}

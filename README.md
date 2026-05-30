# ER Diagram MCP Server

stdio MCP server for AI-assisted database schema design. Works with the **ER Diagram** web app/editor (VIP subscription required).

Parses and validates SQL/DBML, diffs schemas, patches models in memory, and **stages** results for manual sync in the editor — it does not auto-write the canvas or run auto-layout.

## Requirements

- **Node.js ≥ 20**
- **Active VIP** on the ER Diagram app
- **`ER_DIAGRAM_ACCESS_TOKEN`** — session JWT from the editor (side panel → account → **复制令牌** / Copy token), or `GET /api/mcp/token` (cookie session, VIP only)
- **`ER_DIAGRAM_API_URL`** — app origin (default `https://erdiagram.dev/`; use `http://localhost:5173` for local dev)

On startup the server calls `GET /api/mcp/verify` with `Authorization: Bearer <token>`. Each tool checks access again and returns a clear error if VIP/token is missing.

## Install (npm)

```bash
npm install -g er-diagram-mcp
# or use npx in MCP config: npx er-diagram-mcp
```

Published tarball includes prebuilt `dist/` (ER Diagram core is bundled at publish time).

## Build (from source)

Requires the parent **er-diagram** monorepo (`src/lib/er-diagram`). `npm run build` syncs core into `vendor/` then bundles `dist/index.js`.

```bash
# from er-diagram repo root
npm run mcp:build

# or
cd packages/er-diagram-mcp
npm install
npm run build
```

## Publish to npm

From the monorepo (after `npm login`):

```bash
cd packages/er-diagram-mcp
npm run build
npm publish
```

## Tools

| Tool | Description |
|------|-------------|
| `get_schema` | Current session `ERDiagramData` JSON |
| `set_schema` | Replace session schema (`schema` JSON string) |
| `import_sql` | Parse SQL DDL into session (`dialect`: `mysql` \| `postgresql`, default `mysql`) |
| `import_dbml` | Parse DBML into session |
| `export_sql` | Generate SQL from session or optional `schema` JSON |
| `export_dbml` | Generate DBML from session or optional `schema` JSON |
| `patch_schema` | Incremental edits (`operations` array — see below) |
| `validate_schema` | Structural validation **and** lint (`schema` optional) |
| `list_tables` | Table ids/names, column and relation counts |
| `get_table` | One table by `tableId` or `tableName`, with relations |
| `trace_relations` | FK graph walk (`depth` 1–5, `direction`: `both` \| `outgoing` \| `incoming`) |
| `diff_schemas` | Compare `from_schema` → `to_schema` |
| `normalize_from_ddl` | Parse SQL, grid layout, sync FK flags, validate + lint; updates session |
| `stage_for_sync` | `POST /api/mcp/stage` with session schema — user syncs in editor |
| `push_to_canvas` | **Deprecated** — alias of `stage_for_sync` |

Typical flow: `import_sql` or `set_schema` → `patch_schema` → `validate_schema` → `export_sql` → `stage_for_sync`.

## Prompts

| Prompt | Purpose |
|--------|---------|
| `design_schema` | Requirements → model → validate → export SQL → stage |
| `review_migration` | `diff_schemas` + migration risk review |
| `normalize_from_ddl` | Clean imported SQL via `normalize_from_ddl` tool |

## Resource

- `er://schema/current` — in-memory session schema (`application/json`)

## Patch operations (`patch_schema`)

```json
{ "op": "add_table", "table": { "id": "users", "name": "users", "x": 0, "y": 0, "columns": [] } }
{ "op": "remove_table", "tableId": "users" }
{ "op": "rename_table", "tableId": "users", "name": "app_users" }
{ "op": "add_column", "tableId": "users", "column": { "name": "id", "type": "INT", "isPrimaryKey": true } }
{ "op": "remove_column", "tableId": "users", "columnName": "legacy" }
{ "op": "update_column", "tableId": "users", "columnName": "id", "patch": { "type": "BIGINT" } }
{ "op": "add_relation", "relation": { "id": "r1", "fromTableId": "users", "toTableId": "orders", "fromColumn": "id", "toColumn": "user_id", "type": "1:N" } }
{ "op": "remove_relation", "relationId": "r1" }
{ "op": "update_relation", "relationId": "r1", "patch": { "type": "1:1" } }
```

## Editor sync (stage → apply)

MCP never applies to the canvas by itself.

1. **`stage_for_sync`** (or CLI below) → `POST /api/mcp/stage` with `{ "schema": <ERDiagramData> }`.
2. In the editor side panel: **Preview** (optional), then **Replace** (overwrite) or **Append** (same semantics as SQL import Append).
3. Editor calls `POST /api/mcp/apply` with `{ "mode": "replace" | "patch", "diagramId"?, "resolutions"? }` (cookie session).  
   - API mode `patch` = UI **Append**.  
   - Append with table name conflicts → same resolution UI as SQL import (`resolutions`).

`POST /api/mcp/push` only stages (legacy); direct push with `mode` is rejected.

`GET /api/mcp/staged?diagramId=...` — preview staged tables before apply.

## CLI (stage without IDE)

After build:

```bash
# optional: load .sql into session, then stage
node dist/index.js --push path/to/schema.sql

# or from monorepo root
npm run mcp:stage -- path/to/schema.sql
```

Requires `ER_DIAGRAM_ACCESS_TOKEN` and `ER_DIAGRAM_API_URL` in the environment.

## IDE configuration

**Recommended** ([npm package](https://www.npmjs.com/package/er-diagram-mcp)) — copy `.cursor/mcp.json.example` to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "er-diagram": {
      "command": "npx",
      "args": ["-y", "er-diagram-mcp"],
      "env": {
        "ER_DIAGRAM_ACCESS_TOKEN": "<vip-token-from-editor>"
      }
    }
  }
}
```

VIP users: editor side panel → account → **Copy token** (or `GET /api/mcp/token` returns the same snippet with your token filled in).

Local dev against a running app: set `ER_DIAGRAM_API_URL` to `http://localhost:5173`.

**Local monorepo development** (hack on MCP source without publishing):

```json
{
  "command": "node",
  "args": ["packages/er-diagram-mcp/dist/index.js"]
}
```

Requires `npm run mcp:build` in the er-diagram repo root.

Dev without building: `npm run dev` runs `tsx src/index.ts` (still needs monorepo `$er` sources on disk).

## Environment variables

| Variable | Description |
|----------|-------------|
| `ER_DIAGRAM_ACCESS_TOKEN` | Bearer token from editor or `/api/mcp/token` |
| `ER_DIAGRAM_API_URL` | App origin (default `https://erdiagram.dev/`) |

## Package

- npm: [`er-diagram-mcp`](https://www.npmjs.com/package/er-diagram-mcp)
- bin: `er-diagram-mcp` → `dist/index.js`
- MCP server id: `er-diagram` (version `0.1.0`)

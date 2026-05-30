# ER Diagram MCP Server (local)

stdio MCP server for AI-assisted database schema design. **VIP-only** — the server verifies your subscription via `GET /api/mcp/verify` using a session token from the editor.

Reuses the project's SQL/DBML parsers, diff engine, and validation logic — no canvas/auto-layout tools.

## Tools

| Tool | Description |
|------|-------------|
| `get_schema` | Current session `ERDiagramData` |
| `set_schema` | Replace session schema (JSON) |
| `import_sql` / `import_dbml` | Parse into session |
| `export_sql` / `export_dbml` | Generate from session or JSON |
| `patch_schema` | Incremental edits (see below) |
| `validate_schema` | Structural validation + lint |
| `list_tables` / `get_table` | Inspect tables |
| `trace_relations` | FK graph traversal |
| `diff_schemas` | Compare two schemas |
| `normalize_from_ddl` | Parse SQL, grid positions, sync FK flags, validate |
| `stage_for_sync` | Stage schema for manual editor sync (no auto canvas write) |
| `push_to_canvas` | Deprecated alias of `stage_for_sync` |

## Prompts

- `design_schema` — requirements → model → validate → export SQL
- `review_migration` — diff two schemas and assess migration risk
- `normalize_from_ddl` — import and clean SQL DDL

## Resource

- `er://schema/current` — session schema JSON

## Patch operations

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

## Build & run

```bash
cd packages/er-diagram-mcp
npm install
npm run build
```

Dev (no build):

```bash
npm run dev
```

## VIP access token

1. Sign in with an **active VIP** account and open the editor.
2. In the side panel account area, use **Copy token**.
3. Paste the token into your IDE’s MCP server env as `ER_DIAGRAM_ACCESS_TOKEN`.

API (for automation): `GET /api/mcp/token` (cookie session, VIP only).  
Stage from MCP: `POST /api/mcp/stage` with bearer token and `{ "schema": <ERDiagramData>, "patches"?: [...] }`.

Apply from editor (cookie session): `POST /api/mcp/apply` with `{ "mode": "replace" | "patch" }` — user must choose in the side panel. `patch` = append to canvas (same as SQL import Append).

`POST /api/mcp/push` only stages (legacy); direct push with `mode` is rejected.

## IDE configuration

Example for **Cursor** (project `.cursor/mcp.json`; other IDEs use their own MCP config path):

```json
{
  "mcpServers": {
    "er-diagram": {
      "command": "node",
      "args": ["packages/er-diagram-mcp/dist/index.js"],
      "env": {
        "ER_DIAGRAM_API_URL": "http://localhost:5173",
        "ER_DIAGRAM_ACCESS_TOKEN": "<paste-vip-token>"
      }
    }
  }
}
```

Production: set `ER_DIAGRAM_API_URL` to your deployed app origin (same as `PUBLIC_APP_URL`).

From repo root: `npm run mcp:build` then `npm run mcp` (requires env vars above).

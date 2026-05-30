/**
 * Copy shared ER Diagram core from the monorepo into vendor/ for standalone builds & npm publish.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const monorepoCore = path.resolve(pkgRoot, '../../src/lib/er-diagram')
const vendorCore = path.resolve(pkgRoot, 'vendor/er-diagram')

function copyDir(src, dest) {
	fs.mkdirSync(dest, { recursive: true })
	for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
		const from = path.join(src, ent.name)
		const to = path.join(dest, ent.name)
		if (ent.isDirectory()) copyDir(from, to)
		else fs.copyFileSync(from, to)
	}
}

if (!fs.existsSync(monorepoCore)) {
	console.error(
		`[sync-er-core] Missing monorepo core at ${monorepoCore}.\n` +
			'Publish from the er-diagram repo, or copy src/lib/er-diagram into vendor/er-diagram manually.'
	)
	process.exit(1)
}

fs.rmSync(vendorCore, { recursive: true, force: true })
copyDir(monorepoCore, vendorCore)
console.error(`[sync-er-core] Synced → ${vendorCore}`)

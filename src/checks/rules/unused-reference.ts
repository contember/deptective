import * as fs from 'node:fs'
import * as path from 'node:path'
import JSON5 from 'json5'
import type { PackageRule } from '../rule.js'
import type { FixAction } from '../rule.js'
import { groupByPackageDir, mergeFixResults, findTsConfigPath, getPossibleRefPaths, removeReferences } from '../fix-utils.js'

export const unusedReferenceRule: PackageRule = {
	id: 'unused-reference',
	description: 'Tsconfig reference is unused (not imported in source)',
	scope: 'package',

	check(ctx) {
		if (!ctx.hasTsConfig) return []
		const diagnostics: import('../types.js').Diagnostic[] = []

		for (const ref of ctx.referencedPackageNames) {
			if (ctx.importedPackages.has(ref)) continue

			diagnostics.push({
				type: 'unused-reference',
				packageName: ctx.packageName,
				packageDir: ctx.packageDir,
				message: `Tsconfig reference to "${ref}" is unused (not imported in source)`,
				module: ref,
			})
		}
		return diagnostics
	},

	fix(diagnostics, ctx) {
		const byDir = groupByPackageDir(diagnostics)
		return mergeFixResults(
			[...byDir].map(([packageDir, diags]) => {
				const tsconfigPath = findTsConfigPath(packageDir)
				if (!tsconfigPath) {
					return { fixed: 0, actions: [], errors: [`No tsconfig found in ${packageDir}`] }
				}

				let content: string
				try {
					content = fs.readFileSync(tsconfigPath, 'utf-8')
				} catch {
					return { fixed: 0, actions: [], errors: [`Cannot read ${tsconfigPath}`] }
				}

				const tsconfigDir = path.dirname(tsconfigPath)
				let parsed: { references?: { path: string }[]; [key: string]: unknown }
				try {
					parsed = JSON5.parse(content)
				} catch {
					return { fixed: 0, actions: [], errors: [`Cannot parse ${tsconfigPath}`] }
				}

				const refs = parsed.references ?? []
				let fixed = 0
				const actions: FixAction[] = []
				const toRemove = new Set<number>()

				for (const d of diags) {
					if (!d.module) continue

					const targetPkg = ctx.packageIndex.get(d.module)
					if (!targetPkg) continue

					const refPaths = new Set(getPossibleRefPaths(tsconfigDir, targetPkg).map(p => path.resolve(tsconfigDir, p)))
					const idx = refs.findIndex((r, i) => !toRemove.has(i) && refPaths.has(path.resolve(tsconfigDir, r.path)))
					if (idx === -1) continue

					toRemove.add(idx)
					actions.push({
						type: d.type,
						packageName: d.packageName,
						file: tsconfigPath,
						description: `remove reference to "${d.module}" (path: "${refs[idx].path}")`,
					})
					fixed++
				}

				if (!ctx.dryRun && fixed > 0) {
					content = removeReferences(content, refs, toRemove)
					fs.writeFileSync(tsconfigPath, content)
				}

				return { fixed, actions, errors: [] }
			}),
		)
	},
}

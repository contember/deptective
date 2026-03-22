import * as fs from 'node:fs'
import * as path from 'node:path'
import JSON5 from 'json5'
import type { PackageRule } from '../rule.js'
import type { FixAction } from '../rule.js'
import { groupByPackageDir, mergeFixResults, findTsConfigPath, addReference } from '../fix-utils.js'

export const missingReferenceRule: PackageRule = {
	id: 'missing-reference',
	description: 'Import requires a tsconfig project reference that is missing',
	scope: 'package',

	check(ctx) {
		if (!ctx.tsconfigDir) return []
		const diagnostics: import('../types.js').Diagnostic[] = []

		for (const [targetDir, label] of ctx.importTargetDirs) {
			if (ctx.referencedDirs.has(targetDir)) continue

			const refPath = path.relative(ctx.tsconfigDir, targetDir)
			diagnostics.push({
				type: 'missing-reference',
				packageName: ctx.packageName,
				packageDir: ctx.packageDir,
				message: `Import of "${label}" requires tsconfig reference (path: "${refPath}")`,
				module: refPath,
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

				for (const d of diags) {
					if (!d.module) continue

					const resolvedNew = path.resolve(tsconfigDir, d.module)
					const alreadyExists = refs.some(r => path.resolve(tsconfigDir, r.path) === resolvedNew)
					if (alreadyExists) continue

					actions.push({
						type: d.type,
						packageName: d.packageName,
						file: tsconfigPath,
						description: `add reference (path: "${d.module}")`,
					})
					if (!ctx.dryRun) {
						content = addReference(content, d.module)
					}
					fixed++
				}

				if (!ctx.dryRun && fixed > 0) {
					fs.writeFileSync(tsconfigPath, content)
				}

				return { fixed, actions, errors: [] }
			}),
		)
	},
}

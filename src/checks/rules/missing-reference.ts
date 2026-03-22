import * as fs from 'node:fs'
import * as path from 'node:path'
import JSON5 from 'json5'
import type { PackageRule } from '../rule.js'
import type { FixAction } from '../rule.js'
import { groupByPackageDir, mergeFixResults, findTsConfigPath, computeRefPath, addReference } from '../fix-utils.js'

export const missingReferenceRule: PackageRule = {
	id: 'missing-reference',
	description: 'Workspace package imported but not in tsconfig references',
	scope: 'package',

	check(ctx) {
		if (!ctx.hasTsConfig) return []
		const diagnostics: import('../types.js').Diagnostic[] = []

		for (const pkg of ctx.importedPackages) {
			if (!ctx.allWorkspaceNames.has(pkg)) continue
			if (ctx.referencedPackageNames.has(pkg)) continue

			diagnostics.push({
				type: 'missing-reference',
				packageName: ctx.packageName,
				packageDir: ctx.packageDir,
				message: `Workspace package "${pkg}" is imported but not in tsconfig references`,
				module: pkg,
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

					const targetPkg = ctx.packageIndex.get(d.module)
					if (!targetPkg) continue

					const refPath = computeRefPath(tsconfigDir, targetPkg)
					if (!refPath) continue

					const resolvedNew = path.resolve(tsconfigDir, refPath)
					const alreadyExists = refs.some(r => path.resolve(tsconfigDir, r.path) === resolvedNew)
					if (alreadyExists) continue

					actions.push({
						type: d.type,
						packageName: d.packageName,
						file: tsconfigPath,
						description: `add reference to "${d.module}" (path: "${refPath}")`,
					})
					if (!ctx.dryRun) {
						content = addReference(content, refPath)
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

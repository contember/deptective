import type { PackageRule } from '../rule.js'
import type { FixAction } from '../rule.js'
import type { Diagnostic } from '../types.js'
import { groupByPackageDir, mergeFixResults, modifyPackageJson } from '../fix-utils.js'

export const unusedDependencyRule: PackageRule = {
	id: 'unused-dependency',
	description: 'Module in dependencies but never imported',
	scope: 'package',

	check(ctx) {
		const diagnostics: Diagnostic[] = []
		const allowed = new Set(ctx.config.allowedUnusedDependencies)

		for (const dep of Object.keys(ctx.dependencies)) {
			if (allowed.has(dep)) continue
			if (ctx.importedPackages.has(dep)) continue

			diagnostics.push({
				type: 'unused-dependency',
				packageName: ctx.packageName,
				packageDir: ctx.packageDir,
				message: `Module "${dep}" is in dependencies but never imported`,
				module: dep,
			})
		}
		return diagnostics
	},

	fix(diagnostics, ctx) {
		const byDir = groupByPackageDir(diagnostics)
		return mergeFixResults(
			[...byDir].map(([packageDir, diags]) =>
				modifyPackageJson(packageDir, ctx.dryRun, (pkg: any, pkgJsonPath) => {
					let fixed = 0
					const actions: FixAction[] = []

					for (const d of diags) {
						if (!d.module) continue
						if (!pkg.dependencies?.[d.module]) continue

						actions.push({
							type: d.type,
							packageName: d.packageName,
							file: pkgJsonPath,
							description: `remove "${d.module}" from dependencies`,
						})
						if (!ctx.dryRun) {
							delete pkg.dependencies[d.module]
							if (Object.keys(pkg.dependencies).length === 0) {
								delete pkg.dependencies
							}
						}
						fixed++
					}
					return { fixed, actions }
				}),
			),
		)
	},
}

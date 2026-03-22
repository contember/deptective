import type { PackageRule } from '../rule.js'
import type { FixAction } from '../rule.js'
import type { Diagnostic } from '../types.js'
import { groupByPackageDir, mergeFixResults, modifyPackageJson } from '../fix-utils.js'

export const typeOnlyDependencyRule: PackageRule = {
	id: 'type-only-dependency',
	description: 'Module is only used as import type — should be in devDependencies',
	scope: 'package',

	check(ctx) {
		const diagnostics: Diagnostic[] = []

		// Group imports by package name, track if any is non-type-only
		const hasValueImport = new Map<string, boolean>()
		for (const imp of ctx.resolvedImports) {
			if (!ctx.dependencies[imp.packageName]) continue
			const current = hasValueImport.get(imp.packageName) ?? false
			if (!imp.isTypeOnly) {
				hasValueImport.set(imp.packageName, true)
			} else if (!current) {
				hasValueImport.set(imp.packageName, false)
			}
		}

		for (const [pkg, hasValue] of hasValueImport) {
			if (!hasValue) {
				diagnostics.push({
					type: 'type-only-dependency',
					packageName: ctx.packageName,
					packageDir: ctx.packageDir,
					message: `Module "${pkg}" is only used as \`import type\` — consider moving to devDependencies`,
					module: pkg,
				})
			}
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
							description: `move "${d.module}" from dependencies to devDependencies`,
						})
						if (!ctx.dryRun) {
							const version = pkg.dependencies[d.module]
							delete pkg.dependencies[d.module]
							pkg.devDependencies ??= {}
							pkg.devDependencies[d.module] = version
						}
						fixed++
					}
					return { fixed, actions }
				}),
			),
		)
	},
}

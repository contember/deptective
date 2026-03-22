import type { PackageRule } from '../rule.js'
import type { FixAction } from '../rule.js'
import { resolveVersionForDep } from '../version-resolver.js'
import { groupByPackageDir, mergeFixResults, modifyPackageJson } from '../fix-utils.js'

export const missingDependencyRule: PackageRule = {
	id: 'missing-dependency',
	description: 'Module is imported but missing from package.json dependencies',
	scope: 'package',

	check(ctx) {
		const diagnostics: import('../types.js').Diagnostic[] = []
		const globalModules = new Set(ctx.config.globalModules)

		for (const pkg of ctx.importedPackages) {
			if (globalModules.has(pkg)) continue
			if (ctx.dependencies[pkg] || ctx.peerDependencies[pkg]) continue
			if (ctx.devDependencies[pkg]) continue // handled by dev-dependency-in-source

			diagnostics.push({
				type: 'missing-dependency',
				packageName: ctx.packageName,
				packageDir: ctx.packageDir,
				message: `Module "${pkg}" is imported but missing from package.json dependencies`,
				module: pkg,
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
						pkg.dependencies ??= {}
						if (pkg.dependencies[d.module]) continue

						const version = resolveVersionForDep(d.module, d.packageDir, ctx.rootDir, ctx.packageIndex)
						if (!version) continue

						actions.push({
							type: d.type,
							packageName: d.packageName,
							file: pkgJsonPath,
							description: `add "${d.module}": "${version}" to dependencies`,
						})
						if (!ctx.dryRun) {
							pkg.dependencies[d.module] = version
						}
						fixed++
					}
					return { fixed, actions }
				}),
			),
		)
	},
}

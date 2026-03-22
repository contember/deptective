import type { PackageRule } from '../rule.js'

export const enforceCatalogRule: PackageRule = {
	id: 'enforce-catalog',
	description: 'Dependencies must use catalog: or workspace: protocol',
	scope: 'package',

	check(ctx) {
		const fields = ctx.config.enforceCatalog
		if (fields.length === 0) return []

		const diagnostics: import('../types.js').Diagnostic[] = []
		const depFields: Record<string, Record<string, string>> = {
			dependencies: ctx.dependencies,
			devDependencies: ctx.devDependencies,
			peerDependencies: ctx.peerDependencies,
		}

		for (const field of fields) {
			const deps = depFields[field]
			if (!deps) continue

			for (const [name, version] of Object.entries(deps)) {
				if (version.startsWith('workspace:') || version.startsWith('catalog:')) continue

				diagnostics.push({
					type: 'enforce-catalog',
					packageName: ctx.packageName,
					packageDir: ctx.packageDir,
					message: `"${name}": "${version}" in ${field} must use catalog: or workspace: protocol`,
					module: name,
				})
			}
		}
		return diagnostics
	},
}

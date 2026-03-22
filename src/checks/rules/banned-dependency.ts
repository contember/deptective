import type { PackageRule } from '../rule.js'

export const bannedDependencyRule: PackageRule = {
	id: 'banned-dependency',
	description: 'Importing a banned dependency',
	scope: 'package',

	check(ctx) {
		const diagnostics: import('../types.js').Diagnostic[] = []
		const banned = ctx.config.bannedDependencies

		for (const imp of ctx.resolvedImports) {
			if (banned[imp.packageName]) {
				diagnostics.push({
					type: 'banned-dependency',
					packageName: ctx.packageName,
					packageDir: ctx.packageDir,
					message: `"${imp.packageName}" is banned: ${banned[imp.packageName]}`,
					file: imp.file,
					module: imp.packageName,
				})
			}
		}
		return diagnostics
	},
}

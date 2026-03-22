import type { PackageRule } from '../rule.js'
import type { Diagnostic } from '../types.js'

export const selfImportRule: PackageRule = {
	id: 'self-import',
	description: 'Package imports itself',
	scope: 'package',

	check(ctx) {
		const diagnostics: Diagnostic[] = []
		for (const imp of ctx.resolvedImports) {
			if (imp.packageName === ctx.packageName) {
				diagnostics.push({
					type: 'self-import',
					packageName: ctx.packageName,
					packageDir: ctx.packageDir,
					message: `Package imports itself: "${imp.fullSpecifier}"`,
					file: imp.file,
					module: imp.fullSpecifier,
				})
			}
		}
		return diagnostics
	},
}

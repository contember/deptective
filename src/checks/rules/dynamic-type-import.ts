import type { PackageRule } from '../rule.js'

export const dynamicTypeImportRule: PackageRule = {
	id: 'dynamic-type-import',
	description: 'Using import() in type position instead of import type',
	scope: 'package',

	check(ctx) {
		const diagnostics: import('../types.js').Diagnostic[] = []
		for (const imp of ctx.resolvedImports) {
			if (!imp.isImportTypeExpression) continue
			diagnostics.push({
				type: 'dynamic-type-import',
				packageName: ctx.packageName,
				packageDir: ctx.packageDir,
				message: `Dynamic type import \`import('${imp.fullSpecifier}')\` — use \`import type\` instead`,
				file: imp.file,
				module: imp.fullSpecifier,
			})
		}
		return diagnostics
	},
}

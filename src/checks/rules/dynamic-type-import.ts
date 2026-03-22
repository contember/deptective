import type { PackageRule } from '../rule.js'
import type { Diagnostic } from '../types.js'

export const dynamicTypeImportRule: PackageRule = {
	id: 'dynamic-type-import',
	description: 'Using import() in type position instead of import type',
	scope: 'package',

	check(ctx) {
		const diagnostics: Diagnostic[] = []
		for (const record of ctx.importRecords) {
			if (!record.isImportTypeExpression) continue
			diagnostics.push({
				type: 'dynamic-type-import',
				packageName: ctx.packageName,
				packageDir: ctx.packageDir,
				message: `Dynamic type import \`import('${record.specifier}')\` — use \`import type\` instead`,
				file: record.file,
				module: record.specifier,
			})
		}
		return diagnostics
	},
}

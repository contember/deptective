import type { PackageRule } from '../rule.js'

export const forbiddenDotImportRule: PackageRule = {
	id: 'forbidden-dot-import',
	description: 'Relative import of "." or ".."',
	scope: 'package',

	check(ctx) {
		return ctx.dotImports.map(imp => ({
			type: 'forbidden-dot-import' as const,
			packageName: ctx.packageName,
			packageDir: ctx.packageDir,
			message: `Forbidden dot import: "${imp.specifier}"`,
			file: imp.file,
			module: imp.specifier,
		}))
	},
}

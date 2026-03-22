import type { PackageRule } from '../rule.js'
import type { Diagnostic } from '../types.js'
import { isSubpathExported } from '../../exports/resolver.js'

export const forbiddenDirectoryImportRule: PackageRule = {
	id: 'forbidden-directory-import',
	description: 'Subpath import of a package that does not export it',
	scope: 'package',

	check(ctx) {
		const diagnostics: Diagnostic[] = []
		const allowed = new Set(ctx.config.allowedDirectoryImports)
		const exportsCache = new Map<string, boolean | null>()

		for (const imp of ctx.resolvedImports) {
			if (!imp.hasSubpath || !imp.subpath) continue
			if (allowed.has(imp.fullSpecifier)) continue

			const cacheKey = imp.fullSpecifier
			if (!exportsCache.has(cacheKey)) {
				exportsCache.set(cacheKey, isSubpathExported(imp.packageName, imp.subpath, ctx.rootDir))
			}
			const exported = exportsCache.get(cacheKey)
			if (exported === true) continue

			diagnostics.push({
				type: 'forbidden-directory-import',
				packageName: ctx.packageName,
				packageDir: ctx.packageDir,
				message: `Forbidden directory/file import: "${imp.fullSpecifier}"`,
				file: imp.file,
				module: imp.fullSpecifier,
			})
		}
		return diagnostics
	},
}

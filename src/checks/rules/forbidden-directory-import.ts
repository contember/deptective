import type { PackageRule } from '../rule.js'
import type { Diagnostic } from '../types.js'
import { isSubpathExported } from '../../exports/resolver.js'
import { minimatch } from '../../utils/minimatch.js'

const GLOB_CHARS = /[*?]/

export const forbiddenDirectoryImportRule: PackageRule = {
	id: 'forbidden-directory-import',
	description: 'Subpath import of a package that does not export it',
	scope: 'package',

	check(ctx) {
		const diagnostics: Diagnostic[] = []
		const exactAllowed = new Set<string>()
		const globAllowed: string[] = []
		for (const pattern of ctx.config.allowedDirectoryImports) {
			if (GLOB_CHARS.test(pattern)) globAllowed.push(pattern)
			else exactAllowed.add(pattern)
		}
		const exportsCache = new Map<string, boolean | null>()

		for (const imp of ctx.resolvedImports) {
			if (!imp.hasSubpath || !imp.subpath) continue
			if (exactAllowed.has(imp.fullSpecifier)) continue
			if (globAllowed.some(pattern => minimatch(imp.fullSpecifier, pattern))) continue

			const cacheKey = imp.fullSpecifier
			if (!exportsCache.has(cacheKey)) {
				exportsCache.set(cacheKey, isSubpathExported(imp.packageName, imp.subpath, ctx.packageDir, ctx.rootDir))
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

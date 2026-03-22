import * as path from 'node:path'
import { minimatch } from '../../utils/minimatch.js'
import type { PackageRule } from '../rule.js'
import type { Diagnostic } from '../types.js'

const configFileRe = /(?:^|[/\\])[\w.-]+\.config(?:\.[\w-]+)?\.[cm]?[jt]sx?$/

export const devDependencyInSourceRule: PackageRule = {
	id: 'dev-dependency-in-source',
	description: 'devDependency imported in production source',
	scope: 'package',

	check(ctx) {
		const diagnostics: Diagnostic[] = []
		const testPatterns = ctx.config.testPatterns
		const reported = new Set<string>()

		for (const imp of ctx.resolvedImports) {
			if (!ctx.devDependencies[imp.packageName]) continue
			if (ctx.dependencies[imp.packageName] || ctx.peerDependencies[imp.packageName]) continue
			// Type-only imports are fine from devDependencies
			if (imp.isTypeOnly) continue

			const relFile = path.relative(ctx.packageDir, imp.file)
			const isTestFile = testPatterns.some(pattern => minimatch(relFile, pattern))
			if (isTestFile) continue
			// Config files (vite.config.ts, vitest.config.ts, etc.) are dev-only
			if (configFileRe.test(relFile)) continue

			const key = imp.packageName
			if (reported.has(key)) continue
			reported.add(key)

			diagnostics.push({
				type: 'dev-dependency-in-source',
				packageName: ctx.packageName,
				packageDir: ctx.packageDir,
				message: `devDependency "${imp.packageName}" is imported in production source`,
				file: imp.file,
				module: imp.packageName,
			})
		}
		return diagnostics
	},
}

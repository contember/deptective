import type { PackageRule } from '../rule.js'
import type { Diagnostic } from '../types.js'

export const duplicateDependencyRule: PackageRule = {
	id: 'duplicate-dependency',
	description: 'Same module in multiple dependency fields',
	scope: 'package',

	check(ctx) {
		const diagnostics: Diagnostic[] = []
		const deps = Object.keys(ctx.dependencies)
		const peer = new Set(Object.keys(ctx.peerDependencies))
		const dev = new Set(Object.keys(ctx.devDependencies))

		for (const dep of deps) {
			if (peer.has(dep)) {
				diagnostics.push({
					type: 'duplicate-dependency',
					packageName: ctx.packageName,
					packageDir: ctx.packageDir,
					message: `"${dep}" is in both dependencies and peerDependencies`,
					module: dep,
				})
			}
			if (dev.has(dep)) {
				diagnostics.push({
					type: 'duplicate-dependency',
					packageName: ctx.packageName,
					packageDir: ctx.packageDir,
					message: `"${dep}" is in both dependencies and devDependencies`,
					module: dep,
				})
			}
		}
		return diagnostics
	},
}

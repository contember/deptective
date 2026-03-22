import * as fs from 'node:fs'
import type { PackageRule } from '../rule.js'
import type { Diagnostic } from '../types.js'
import { resolveDepPackageJson } from '../version-resolver.js'

export const missingPeerDependencyRule: PackageRule = {
	id: 'missing-peer-dependency',
	description: 'Dependency has unmet peer dependencies',
	scope: 'package',

	check(ctx) {
		const diagnostics: Diagnostic[] = []
		const allDeps = { ...ctx.dependencies, ...ctx.peerDependencies }
		const reported = new Set<string>()

		for (const depName of Object.keys(allDeps)) {
			const depPkgPath = resolveDepPackageJson(depName, ctx.rootDir, ctx.packageDir)
			if (!depPkgPath) continue

			let depPkg: { peerDependencies?: Record<string, string>; peerDependenciesMeta?: Record<string, { optional?: boolean }> }
			try {
				depPkg = JSON.parse(fs.readFileSync(depPkgPath, 'utf-8'))
			} catch {
				continue
			}

			if (!depPkg.peerDependencies) continue

			for (const [peerName, _peerVersion] of Object.entries(depPkg.peerDependencies)) {
				const isOptional = depPkg.peerDependenciesMeta?.[peerName]?.optional === true
				if (isOptional) continue
				if (allDeps[peerName] || ctx.devDependencies[peerName]) continue
				// In monorepos, peer deps may be satisfied by hoisted packages
				if (resolveDepPackageJson(peerName, ctx.rootDir, ctx.packageDir)) continue

				const key = `${depName}:${peerName}`
				if (reported.has(key)) continue
				reported.add(key)

				diagnostics.push({
					type: 'missing-peer-dependency',
					packageName: ctx.packageName,
					packageDir: ctx.packageDir,
					message: `"${depName}" requires peer dependency "${peerName}" which is not installed`,
					module: peerName,
				})
			}
		}
		return diagnostics
	},
}

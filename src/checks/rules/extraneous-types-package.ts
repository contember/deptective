import * as fs from 'node:fs'
import type { PackageRule } from '../rule.js'
import type { FixAction } from '../rule.js'
import { resolveDepPackageJson } from '../version-resolver.js'
import { groupByPackageDir, mergeFixResults, modifyPackageJson } from '../fix-utils.js'

export const extraneousTypesPackageRule: PackageRule = {
	id: 'extraneous-types-package',
	description: '@types package is unnecessary because the base package ships its own types',
	scope: 'package',

	check(ctx) {
		const diagnostics: import('../types.js').Diagnostic[] = []
		const allDeps = { ...ctx.dependencies, ...ctx.devDependencies }

		for (const depName of Object.keys(allDeps)) {
			if (!depName.startsWith('@types/')) continue

			const basePkg = typesPackageToBase(depName)

			const basePkgPath = resolveDepPackageJson(basePkg, ctx.rootDir, ctx.packageDir)
			if (!basePkgPath) continue

			let basePkgJson: { types?: string; typings?: string; exports?: unknown }
			try {
				basePkgJson = JSON.parse(fs.readFileSync(basePkgPath, 'utf-8'))
			} catch {
				continue
			}

			if (!basePkgJson.types && !basePkgJson.typings && !hasExportedTypes(basePkgJson.exports)) continue

			diagnostics.push({
				type: 'extraneous-types-package',
				packageName: ctx.packageName,
				packageDir: ctx.packageDir,
				message: `"${depName}" is unnecessary — "${basePkg}" ships its own types`,
				module: depName,
			})
		}
		return diagnostics
	},

	fix(diagnostics, ctx) {
		const byDir = groupByPackageDir(diagnostics)
		return mergeFixResults(
			[...byDir].map(([packageDir, diags]) =>
				modifyPackageJson(packageDir, ctx.dryRun, (pkg: any, pkgJsonPath) => {
					let fixed = 0
					const actions: FixAction[] = []

					for (const d of diags) {
						if (!d.module) continue

						for (const field of ['dependencies', 'devDependencies'] as const) {
							if (!pkg[field]?.[d.module]) continue

							actions.push({
								type: d.type,
								packageName: d.packageName,
								file: pkgJsonPath,
								description: `remove "${d.module}" from ${field}`,
							})
							if (!ctx.dryRun) {
								delete pkg[field][d.module]
								if (Object.keys(pkg[field]).length === 0) {
									delete pkg[field]
								}
							}
							fixed++
							break
						}
					}
					return { fixed, actions }
				}),
			),
		)
	},
}

/**
 * Map @types package name to the base package name.
 * @types/react → react
 * @types/babel__core → @babel/core
 */
function typesPackageToBase(typesPackage: string): string {
	const name = typesPackage.slice('@types/'.length)
	const scopeIdx = name.indexOf('__')
	if (scopeIdx !== -1) {
		return `@${name.slice(0, scopeIdx)}/${name.slice(scopeIdx + 2)}`
	}
	return name
}

/** Check if the exports field contains a "types" condition at any level */
function hasExportedTypes(exports: unknown): boolean {
	if (typeof exports !== 'object' || exports === null) return false
	if (Array.isArray(exports)) return exports.some(hasExportedTypes)
	const obj = exports as Record<string, unknown>
	if ('types' in obj) return true
	return Object.values(obj).some(hasExportedTypes)
}

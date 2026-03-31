import type { WorkspaceRule } from '../rule.js'
import type { Diagnostic } from '../types.js'
import type { WorkspacePackage } from '../../workspace/types.js'

export const inconsistentVersionRule: WorkspaceRule = {
	id: 'inconsistent-version',
	description: 'Same external dependency with different versions across workspace',
	scope: 'workspace',

	check(packages: WorkspacePackage[]) {
		const diagnostics: Diagnostic[] = []
		const nameSet = new Set(packages.map(p => p.name))

		// Collect versions separately for dependencies and peerDependencies
		const depsMap = new Map<string, Map<string, string[]>>()
		const peerDepsMap = new Map<string, Map<string, string[]>>()

		for (const pkg of packages) {
			for (const [dep, version] of Object.entries(pkg.packageJson.dependencies ?? {})) {
				if (nameSet.has(dep)) continue // skip workspace deps
				if (isWorkspaceProtocol(version)) continue
				addVersion(depsMap, dep, normalizeVersion(version), pkg.name)
			}
			for (const [dep, version] of Object.entries(pkg.packageJson.peerDependencies ?? {})) {
				if (nameSet.has(dep)) continue
				if (isWorkspaceProtocol(version)) continue
				if (isOpenRange(version)) continue
				addVersion(peerDepsMap, dep, normalizeVersion(version), pkg.name)
			}
		}

		reportInconsistencies(depsMap, packages, diagnostics)
		reportInconsistencies(peerDepsMap, packages, diagnostics)

		return diagnostics
	},
}

function reportInconsistencies(
	versionMap: Map<string, Map<string, string[]>>,
	packages: WorkspacePackage[],
	diagnostics: Diagnostic[],
) {
	for (const [dep, versions] of versionMap) {
		if (versions.size <= 1) continue

		const details = [...versions.entries()]
			.map(([v, pkgs]) => `${v} (${pkgs.join(', ')})`)
			.join(', ')

		// Report on the first package that uses each version
		const firstPkg = [...versions.values()][0][0]
		const firstPkgData = packages.find(p => p.name === firstPkg)

		diagnostics.push({
			type: 'inconsistent-version',
			packageName: firstPkg,
			packageDir: firstPkgData?.dir ?? '',
			message: `Inconsistent versions of "${dep}": ${details}`,
			module: dep,
		})
	}
}

function addVersion(map: Map<string, Map<string, string[]>>, dep: string, version: string, pkg: string) {
	if (!map.has(dep)) map.set(dep, new Map())
	const versions = map.get(dep)!
	if (!versions.has(version)) versions.set(version, [])
	versions.get(version)!.push(pkg)
}

function isWorkspaceProtocol(version: string): boolean {
	return version.startsWith('workspace:') || version.startsWith('catalog:')
}

function isOpenRange(version: string): boolean {
	return version === '*' || version.startsWith('>=') || version.startsWith('>')
}

function normalizeVersion(version: string): string {
	return version.trim()
}

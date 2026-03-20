import type { Diagnostic } from './types.js'
import type { WorkspacePackage } from '../workspace/types.js'

export function runWorkspaceChecks(packages: WorkspacePackage[]): Diagnostic[] {
	return [
		...checkCircularDependencies(packages),
		...checkInconsistentVersions(packages),
	]
}

function checkCircularDependencies(packages: WorkspacePackage[]): Diagnostic[] {
	const diagnostics: Diagnostic[] = []
	const nameSet = new Set(packages.map(p => p.name))

	// Build adjacency list: package name -> workspace package names it depends on
	const graph = new Map<string, string[]>()
	const dirMap = new Map<string, string>()
	for (const pkg of packages) {
		const deps = [
			...Object.keys(pkg.packageJson.dependencies ?? {}),
			...Object.keys(pkg.packageJson.peerDependencies ?? {}),
		].filter(d => nameSet.has(d))
		graph.set(pkg.name, deps)
		dirMap.set(pkg.name, pkg.dir)
	}

	// Find all cycles using DFS
	const reported = new Set<string>()
	const visited = new Set<string>()
	const inStack = new Set<string>()

	function dfs(node: string, path: string[]) {
		if (inStack.has(node)) {
			// Found a cycle — extract it
			const cycleStart = path.indexOf(node)
			const cycle = path.slice(cycleStart)
			const key = [...cycle].sort().join(' -> ')
			if (!reported.has(key)) {
				reported.add(key)
				diagnostics.push({
					type: 'circular-workspace-dependency',
					packageName: cycle[0],
					packageDir: dirMap.get(cycle[0]) ?? '',
					message: `Circular dependency: ${[...cycle, node].join(' -> ')}`,
				})
			}
			return
		}
		if (visited.has(node)) return

		inStack.add(node)
		path.push(node)

		for (const dep of graph.get(node) ?? []) {
			dfs(dep, path)
		}

		path.pop()
		inStack.delete(node)
		visited.add(node)
	}

	for (const name of graph.keys()) {
		dfs(name, [])
	}

	return diagnostics
}

function checkInconsistentVersions(packages: WorkspacePackage[]): Diagnostic[] {
	const diagnostics: Diagnostic[] = []
	const nameSet = new Set(packages.map(p => p.name))

	// Collect all external dep versions across workspace: depName -> Map<version, packageNames[]>
	const versionMap = new Map<string, Map<string, string[]>>()

	for (const pkg of packages) {
		for (const [dep, version] of Object.entries(pkg.packageJson.dependencies ?? {})) {
			if (nameSet.has(dep)) continue // skip workspace deps
			if (isWorkspaceProtocol(version)) continue
			addVersion(versionMap, dep, normalizeVersion(version), pkg.name)
		}
		for (const [dep, version] of Object.entries(pkg.packageJson.peerDependencies ?? {})) {
			if (nameSet.has(dep)) continue
			if (isWorkspaceProtocol(version)) continue
			addVersion(versionMap, dep, normalizeVersion(version), pkg.name)
		}
	}

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

	return diagnostics
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

function normalizeVersion(version: string): string {
	return version.trim()
}

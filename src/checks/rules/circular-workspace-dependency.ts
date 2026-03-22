import type { WorkspaceRule } from '../rule.js'
import type { Diagnostic } from '../types.js'
import type { WorkspacePackage } from '../../workspace/types.js'

export const circularWorkspaceDependencyRule: WorkspaceRule = {
	id: 'circular-workspace-dependency',
	description: 'Circular dependency between workspace packages',
	scope: 'workspace',

	check(packages: WorkspacePackage[]) {
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
	},
}

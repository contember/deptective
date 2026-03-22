import * as fs from 'node:fs'
import * as path from 'node:path'
import type { WorkspacePackage } from '../workspace/types.js'

export function resolveVersionForDep(
	depName: string,
	packageDir: string,
	rootDir: string,
	packageIndex: Map<string, WorkspacePackage>,
): string | null {
	// 1. Workspace package
	if (packageIndex.has(depName)) {
		return 'workspace:*'
	}

	// 2. Find version used by other packages in the workspace (most common wins, prefer catalog:/workspace:)
	const versionCounts = new Map<string, number>()
	for (const pkg of packageIndex.values()) {
		const version =
			pkg.packageJson.dependencies?.[depName] ??
			pkg.packageJson.peerDependencies?.[depName] ??
			pkg.packageJson.devDependencies?.[depName]
		if (version) {
			versionCounts.set(version, (versionCounts.get(version) ?? 0) + 1)
		}
	}
	if (versionCounts.size > 0) {
		return [...versionCounts.entries()]
			.sort((a, b) => {
				// Prefer catalog:/workspace: protocols
				const aProto = a[0].startsWith('catalog:') || a[0].startsWith('workspace:') ? 1 : 0
				const bProto = b[0].startsWith('catalog:') || b[0].startsWith('workspace:') ? 1 : 0
				if (aProto !== bProto) return bProto - aProto
				return b[1] - a[1]
			})[0][0]
	}

	// 3. Read from installed node_modules
	for (const base of [packageDir, rootDir]) {
		const pkgJsonPath = path.join(base, 'node_modules', depName, 'package.json')
		try {
			const content = fs.readFileSync(pkgJsonPath, 'utf-8')
			const { version } = JSON.parse(content)
			if (version) return `^${version}`
		} catch {
			// continue
		}
	}

	return null
}

export function resolveDepPackageJson(depName: string, rootDir: string, packageDir: string): string | null {
	const candidates = [
		path.join(packageDir, 'node_modules', depName, 'package.json'),
		path.join(rootDir, 'node_modules', depName, 'package.json'),
	]
	for (const c of candidates) {
		if (fs.existsSync(c)) return c
	}
	return null
}

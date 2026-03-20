import * as path from 'node:path'
import * as fs from 'node:fs'
import type { TsConfigData } from './reader.js'
import type { WorkspacePackage } from '../workspace/types.js'

export function resolveReferencedPackageNames(
	tsconfig: TsConfigData,
	allPackages: WorkspacePackage[],
): string[] {
	const dirToPackage = buildDirIndex(allPackages)
	const names: string[] = []

	for (const ref of tsconfig.references) {
		const refDir = path.resolve(tsconfig.configDir, ref.path)
		const pkg = findPackageForDir(refDir, dirToPackage)
		if (pkg) {
			names.push(pkg.name)
		}
	}
	return names
}

function buildDirIndex(packages: WorkspacePackage[]): Map<string, WorkspacePackage> {
	const map = new Map<string, WorkspacePackage>()
	for (const pkg of packages) {
		map.set(path.normalize(pkg.dir), pkg)
	}
	return map
}

/**
 * Given a directory that a tsconfig reference points to, find the workspace package it belongs to.
 * Walks upward from refDir looking for a directory that matches a known workspace package.
 * This handles references like `../../other-pkg/src` — we walk up to `../../other-pkg` and find it.
 */
function findPackageForDir(refDir: string, dirIndex: Map<string, WorkspacePackage>): WorkspacePackage | undefined {
	let current = path.normalize(refDir)
	const root = path.parse(current).root

	while (current !== root) {
		const pkg = dirIndex.get(current)
		if (pkg) return pkg

		// Also check if there's a package.json here that matches a workspace package
		const pkgJsonPath = path.join(current, 'package.json')
		if (fs.existsSync(pkgJsonPath)) {
			// If we found a package.json but it's not in our index, stop walking up
			// — we've crossed into a different package that's not in the workspace
			return undefined
		}

		current = path.dirname(current)
	}
	return undefined
}

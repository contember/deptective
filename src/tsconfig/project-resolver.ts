import * as path from 'node:path'
import { existsSync } from 'node:fs'
import type { TsConfigData } from './reader.js'
import type { WorkspacePackage } from '../workspace/types.js'
import type { ImportRecord } from '../imports/collector.js'
import type { ResolvedImport } from '../imports/resolver.js'

/**
 * Resolve tsconfig references to absolute directory paths.
 * Returns Map<absoluteDir, originalRefPath> for ALL references.
 */
export function resolveReferenceDirs(tsconfig: TsConfigData): Map<string, string> {
	const dirs = new Map<string, string>()
	for (const ref of tsconfig.references) {
		const resolved = path.resolve(tsconfig.configDir, ref.path)
		dirs.set(path.normalize(resolved), ref.path)
	}
	return dirs
}

/**
 * Resolve import target project directories.
 * Returns Map<absoluteDir, label> for imports that cross tsconfig project boundaries.
 * Label is the package name (for workspace imports) or relative path (for relative imports).
 */
export function resolveImportTargetDirs(
	records: ImportRecord[],
	resolvedImports: ResolvedImport[],
	allPackages: WorkspacePackage[],
	currentProjectDir: string,
	rootDir: string,
): Map<string, string> {
	const targets = new Map<string, string>()
	const workspaceIndex = new Map(allPackages.map(p => [p.name, p]))
	const normalizedCurrent = path.normalize(currentProjectDir)

	// 1. Workspace package imports
	for (const imp of resolvedImports) {
		const pkg = workspaceIndex.get(imp.packageName)
		if (!pkg) continue

		const projectDir = findPackageProjectDir(pkg)
		if (!projectDir) continue

		const normalized = path.normalize(projectDir)
		if (normalized === normalizedCurrent) continue

		if (!targets.has(normalized)) {
			targets.set(normalized, imp.packageName)
		}
	}

	// 2. Relative imports crossing project boundaries
	for (const record of records) {
		if (!record.specifier.startsWith('.')) continue
		if (record.specifier === '.' || record.specifier === '..') continue

		const resolvedTarget = path.resolve(path.dirname(record.file), record.specifier)
		const targetDir = findOwningProjectDir(resolvedTarget, rootDir)
		if (!targetDir) continue

		const normalized = path.normalize(targetDir)
		if (normalized === normalizedCurrent) continue

		if (!targets.has(normalized)) {
			targets.set(normalized, path.relative(currentProjectDir, targetDir))
		}
	}

	return targets
}

/**
 * Find the tsconfig project directory that owns a given path.
 * Walks up from the path looking for tsconfig.json, stopping at rootDir.
 */
export function findOwningProjectDir(targetPath: string, rootDir: string): string | null {
	let dir = path.normalize(targetPath)
	const root = path.normalize(rootDir)

	while (dir.startsWith(root) || dir === root) {
		if (existsSync(path.join(dir, 'tsconfig.json'))) return dir
		const parent = path.dirname(dir)
		if (parent === dir) break
		dir = parent
	}
	return null
}

function findPackageProjectDir(pkg: WorkspacePackage): string | null {
	const srcTsconfig = path.join(pkg.dir, 'src', 'tsconfig.json')
	if (existsSync(srcTsconfig)) return path.join(pkg.dir, 'src')

	const rootTsconfig = path.join(pkg.dir, 'tsconfig.json')
	if (existsSync(rootTsconfig)) return pkg.dir

	return null
}

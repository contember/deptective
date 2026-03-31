import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Check if a subpath import is valid according to the target package's `exports` field.
 * Returns:
 * - true: subpath is explicitly exported
 * - false: package has exports but this subpath is not exported
 * - null: package.json not found or has no exports field (can't validate)
 */
export function isSubpathExported(
	packageName: string,
	subpath: string,
	packageDir: string,
	rootDir: string,
): boolean | null {
	const exports = readPackageExports(packageName, packageDir, rootDir)
	if (exports === null) return null

	const importPath = '.' + subpath // subpath is like "/client", we need "./client"
	return matchExports(exports, importPath)
}

type ExportsField = string | string[] | { [key: string]: ExportsField } | null

function readPackageExports(packageName: string, packageDir: string, rootDir: string): ExportsField | null {
	const pkgJsonPath = findPackageJson(packageName, packageDir, rootDir)
	if (!pkgJsonPath) return null

	try {
		const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
		return pkg.exports ?? null
	} catch {
		return null
	}
}

/**
 * Find a dependency's package.json by walking up from packageDir to rootDir,
 * checking node_modules at each level (standard Node.js resolution).
 */
function findPackageJson(packageName: string, packageDir: string, rootDir: string): string | null {
	const resolvedRoot = path.resolve(rootDir)
	let dir = path.resolve(packageDir)

	while (true) {
		const candidate = path.join(dir, 'node_modules', packageName, 'package.json')
		if (fs.existsSync(candidate)) return candidate

		if (dir === resolvedRoot || dir === path.dirname(dir)) break
		dir = path.dirname(dir)
	}

	return null
}

function matchExports(exports: ExportsField, subpath: string): boolean {
	if (exports === null) return false
	if (typeof exports === 'string') {
		// exports is a string — only the root "." is exported
		return subpath === '.'
	}
	if (Array.isArray(exports)) {
		return subpath === '.'
	}

	// exports is an object
	// Check if any key is a subpath pattern (starts with ".")
	const hasSubpathKeys = Object.keys(exports).some(k => k.startsWith('.'))
	if (!hasSubpathKeys) {
		// Conditional export for root only (e.g. { "import": "./index.mjs", "require": "./index.cjs" })
		return subpath === '.'
	}

	// Match against subpath patterns
	for (const pattern of Object.keys(exports)) {
		if (!pattern.startsWith('.')) continue
		if (matchSubpathPattern(pattern, subpath)) return true
	}

	return false
}

function matchSubpathPattern(pattern: string, subpath: string): boolean {
	if (pattern === subpath) return true

	const starIdx = pattern.indexOf('*')
	if (starIdx === -1) return false

	const prefix = pattern.substring(0, starIdx)
	const suffix = pattern.substring(starIdx + 1)

	return subpath.startsWith(prefix)
		&& subpath.endsWith(suffix)
		&& subpath.length >= prefix.length + suffix.length
}

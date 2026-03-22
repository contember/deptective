import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Diagnostic } from './types.js'
import type { FixAction, FixResult } from './rule.js'
import type { WorkspacePackage } from '../workspace/types.js'

export function groupByPackageDir(diagnostics: Diagnostic[]): Map<string, Diagnostic[]> {
	const map = new Map<string, Diagnostic[]>()
	for (const d of diagnostics) {
		const list = map.get(d.packageDir) ?? []
		list.push(d)
		map.set(d.packageDir, list)
	}
	return map
}

export function mergeFixResults(results: FixResult[]): FixResult {
	return {
		fixed: results.reduce((sum, r) => sum + r.fixed, 0),
		actions: results.flatMap(r => r.actions),
		errors: results.flatMap(r => r.errors),
	}
}

export function modifyPackageJson(
	packageDir: string,
	dryRun: boolean,
	modify: (pkg: Record<string, unknown>, pkgJsonPath: string) => { fixed: number; actions: FixAction[] },
): FixResult {
	const pkgJsonPath = path.join(packageDir, 'package.json')
	let content: string
	try {
		content = fs.readFileSync(pkgJsonPath, 'utf-8')
	} catch {
		return { fixed: 0, actions: [], errors: [`Cannot read ${pkgJsonPath}`] }
	}

	const pkg = JSON.parse(content)
	const result = modify(pkg, pkgJsonPath)

	if (!dryRun && result.fixed > 0) {
		const indent = detectIndent(content)
		fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, indent) + '\n')
	}

	return { ...result, errors: [] }
}

export function findTsConfigPath(packageDir: string): string | null {
	for (const loc of ['src/tsconfig.json', 'tsconfig.json']) {
		const full = path.join(packageDir, loc)
		if (fs.existsSync(full)) return full
	}
	return null
}

export function computeRefPath(fromDir: string, targetPkg: WorkspacePackage): string | null {
	// Try src/ subdir first (common convention for project references)
	const srcTsconfig = path.join(targetPkg.dir, 'src', 'tsconfig.json')
	if (fs.existsSync(srcTsconfig)) {
		return path.relative(fromDir, path.join(targetPkg.dir, 'src'))
	}
	// Fall back to package root
	return path.relative(fromDir, targetPkg.dir)
}

export function getPossibleRefPaths(fromDir: string, targetPkg: WorkspacePackage): string[] {
	return [
		path.relative(fromDir, path.join(targetPkg.dir, 'src')),
		path.relative(fromDir, targetPkg.dir),
	]
}

export function removeReferences(content: string, refs: { path: string }[], toRemove: Set<number>): string {
	for (const idx of [...toRemove].reverse()) {
		const ref = refs[idx]
		const escaped = escapeForRegex(ref.path)
		// Match line with this reference entry, including leading whitespace and trailing comma/newline
		const lineRe = new RegExp(`[ \\t]*\\{[^}]*"path"\\s*:\\s*"${escaped}"[^}]*\\},?[ \\t]*\\n?`)
		content = content.replace(lineRe, '')
	}
	return content
}

export function addReference(content: string, refPath: string): string {
	const entry = `\t\t{ "path": "${refPath}" }`
	// Find the closing ] of "references" array
	const refsRe = /("references"\s*:\s*\[)([\s\S]*?)(\s*\])/
	const match = content.match(refsRe)
	if (!match) return content

	const existingContent = match[2].trimEnd()
	// Add comma after last entry if needed
	const needsComma = existingContent.length > 0 && !existingContent.endsWith(',')
	const comma = needsComma ? ',' : ''
	const newRefsContent = `${existingContent}${comma}\n${entry},`
	return content.replace(refsRe, `${match[1]}${newRefsContent}${match[3]}`)
}

function escapeForRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function detectIndent(content: string): string {
	const match = content.match(/^(\s+)"/m)
	return match?.[1] ?? '\t'
}

import * as fs from 'node:fs'
import * as path from 'node:path'
import JSON5 from 'json5'
import type { Diagnostic, DiagnosticType } from './checks/types.js'
import type { WorkspacePackage } from './workspace/types.js'

const FIXABLE_TYPES: DiagnosticType[] = [
	'missing-dependency',
	'unused-dependency',
	'unused-reference',
	'missing-reference',
	'type-only-dependency',
]

export function isFixable(type: DiagnosticType): boolean {
	return FIXABLE_TYPES.includes(type)
}

export interface FixAction {
	type: DiagnosticType
	packageName: string
	file: string
	description: string
}

interface FixContext {
	allPackages: WorkspacePackage[]
	rootDir: string
	dryRun?: boolean
}

interface FixResult {
	fixed: number
	actions: FixAction[]
	errors: string[]
}

export function applyFixes(diagnostics: Diagnostic[], ctx: FixContext): FixResult {
	const fixable = diagnostics.filter(d => isFixable(d.type))
	const errors: string[] = []
	const actions: FixAction[] = []
	let fixed = 0

	// Group by package dir for efficient file operations
	const byPackageDir = new Map<string, Diagnostic[]>()
	for (const d of fixable) {
		const list = byPackageDir.get(d.packageDir) ?? []
		list.push(d)
		byPackageDir.set(d.packageDir, list)
	}

	const packageIndex = new Map<string, WorkspacePackage>()
	for (const pkg of ctx.allPackages) {
		packageIndex.set(pkg.name, pkg)
	}

	for (const [packageDir, diags] of byPackageDir) {
		const pkgJsonDiags = diags.filter(d =>
			d.type === 'missing-dependency' ||
			d.type === 'unused-dependency' ||
			d.type === 'type-only-dependency',
		)
		const tsconfigDiags = diags.filter(d =>
			d.type === 'missing-reference' ||
			d.type === 'unused-reference',
		)

		if (pkgJsonDiags.length > 0) {
			const result = fixPackageJson(packageDir, pkgJsonDiags, packageIndex, ctx.rootDir, ctx.dryRun ?? false)
			fixed += result.fixed
			actions.push(...result.actions)
			errors.push(...result.errors)
		}

		if (tsconfigDiags.length > 0) {
			const result = fixTsConfig(packageDir, tsconfigDiags, packageIndex, ctx.dryRun ?? false)
			fixed += result.fixed
			actions.push(...result.actions)
			errors.push(...result.errors)
		}
	}

	return { fixed, actions, errors }
}

function fixPackageJson(
	packageDir: string,
	diags: Diagnostic[],
	packageIndex: Map<string, WorkspacePackage>,
	rootDir: string,
	dryRun: boolean,
): FixResult {
	const pkgJsonPath = path.join(packageDir, 'package.json')
	let content: string
	try {
		content = fs.readFileSync(pkgJsonPath, 'utf-8')
	} catch {
		return { fixed: 0, actions: [], errors: [`Cannot read ${pkgJsonPath}`] }
	}

	const pkg = JSON.parse(content)
	let fixed = 0
	const actions: FixAction[] = []

	for (const d of diags) {
		if (!d.module) continue

		if (d.type === 'missing-dependency') {
			pkg.dependencies ??= {}
			if (!pkg.dependencies[d.module]) {
				const version = resolveVersionForDep(d.module, d.packageDir, rootDir, packageIndex)
				if (version) {
					actions.push({
						type: d.type,
						packageName: d.packageName,
						file: pkgJsonPath,
						description: `add "${d.module}": "${version}" to dependencies`,
					})
					if (!dryRun) {
						pkg.dependencies[d.module] = version
					}
					fixed++
				}
			}
		}

		if (d.type === 'unused-dependency') {
			if (pkg.dependencies?.[d.module]) {
				actions.push({
					type: d.type,
					packageName: d.packageName,
					file: pkgJsonPath,
					description: `remove "${d.module}" from dependencies`,
				})
				if (!dryRun) {
					delete pkg.dependencies[d.module]
					if (Object.keys(pkg.dependencies).length === 0) {
						delete pkg.dependencies
					}
				}
				fixed++
			}
		}

		if (d.type === 'type-only-dependency') {
			if (pkg.dependencies?.[d.module]) {
				actions.push({
					type: d.type,
					packageName: d.packageName,
					file: pkgJsonPath,
					description: `move "${d.module}" from dependencies to devDependencies`,
				})
				if (!dryRun) {
					const version = pkg.dependencies[d.module]
					delete pkg.dependencies[d.module]
					pkg.devDependencies ??= {}
					pkg.devDependencies[d.module] = version
				}
				fixed++
			}
		}
	}

	if (!dryRun && fixed > 0) {
		const indent = detectIndent(content)
		const newContent = JSON.stringify(pkg, null, indent) + '\n'
		fs.writeFileSync(pkgJsonPath, newContent)
	}

	return { fixed, actions, errors: [] }
}

function resolveVersionForDep(
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

function fixTsConfig(
	packageDir: string,
	diags: Diagnostic[],
	packageIndex: Map<string, WorkspacePackage>,
	dryRun: boolean,
): FixResult {
	const tsconfigPath = findTsConfigPath(packageDir)
	if (!tsconfigPath) {
		return { fixed: 0, actions: [], errors: [`No tsconfig found in ${packageDir}`] }
	}

	let content: string
	try {
		content = fs.readFileSync(tsconfigPath, 'utf-8')
	} catch {
		return { fixed: 0, actions: [], errors: [`Cannot read ${tsconfigPath}`] }
	}

	const tsconfigDir = path.dirname(tsconfigPath)
	let parsed: { references?: { path: string }[];  [key: string]: unknown }
	try {
		parsed = JSON5.parse(content)
	} catch {
		return { fixed: 0, actions: [], errors: [`Cannot parse ${tsconfigPath}`] }
	}

	const refs: { path: string }[] = parsed.references ?? []
	let fixed = 0
	const actions: FixAction[] = []

	// Collect removals and additions
	const toRemove = new Set<number>()
	const toAdd: string[] = []

	for (const d of diags) {
		if (!d.module) continue

		if (d.type === 'unused-reference') {
			const targetPkg = packageIndex.get(d.module)
			if (!targetPkg) continue

			const refPaths = new Set(getPossibleRefPaths(tsconfigDir, targetPkg).map(p => path.resolve(tsconfigDir, p)))
			const idx = refs.findIndex((r, i) => !toRemove.has(i) && refPaths.has(path.resolve(tsconfigDir, r.path)))
			if (idx !== -1) {
				toRemove.add(idx)
				actions.push({
					type: d.type,
					packageName: d.packageName,
					file: tsconfigPath,
					description: `remove reference to "${d.module}" (path: "${refs[idx].path}")`,
				})
				fixed++
			}
		}

		if (d.type === 'missing-reference') {
			const targetPkg = packageIndex.get(d.module)
			if (!targetPkg) continue

			const refPath = computeRefPath(tsconfigDir, targetPkg)
			if (!refPath) continue

			const resolvedNew = path.resolve(tsconfigDir, refPath)
			const alreadyExists = refs.some(r => path.resolve(tsconfigDir, r.path) === resolvedNew)
			if (alreadyExists) continue

			toAdd.push(refPath)
			actions.push({
				type: d.type,
				packageName: d.packageName,
				file: tsconfigPath,
				description: `add reference to "${d.module}" (path: "${refPath}")`,
			})
			fixed++
		}
	}

	if (!dryRun && fixed > 0) {
		// Text-based manipulation to preserve formatting
		let newContent = content

		// Remove references (process in reverse order to preserve indices)
		if (toRemove.size > 0) {
			newContent = removeReferences(newContent, refs, toRemove)
		}

		// Add references
		for (const refPath of toAdd) {
			newContent = addReference(newContent, refPath)
		}

		fs.writeFileSync(tsconfigPath, newContent)
	}
	return { fixed, actions, errors: [] }
}

function removeReferences(content: string, refs: { path: string }[], toRemove: Set<number>): string {
	for (const idx of [...toRemove].reverse()) {
		const ref = refs[idx]
		const escaped = escapeForRegex(ref.path)
		// Match line with this reference entry, including leading whitespace and trailing comma/newline
		const lineRe = new RegExp(`[ \\t]*\\{[^}]*"path"\\s*:\\s*"${escaped}"[^}]*\\},?[ \\t]*\\n?`)
		content = content.replace(lineRe, '')
	}
	return content
}

function addReference(content: string, refPath: string): string {
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

function findTsConfigPath(packageDir: string): string | null {
	for (const loc of ['src/tsconfig.json', 'tsconfig.json']) {
		const full = path.join(packageDir, loc)
		if (fs.existsSync(full)) return full
	}
	return null
}

function computeRefPath(fromDir: string, targetPkg: WorkspacePackage): string | null {
	// Try src/ subdir first (common convention for project references)
	const srcTsconfig = path.join(targetPkg.dir, 'src', 'tsconfig.json')
	if (fs.existsSync(srcTsconfig)) {
		return path.relative(fromDir, path.join(targetPkg.dir, 'src'))
	}
	// Fall back to package root
	return path.relative(fromDir, targetPkg.dir)
}

function getPossibleRefPaths(fromDir: string, targetPkg: WorkspacePackage): string[] {
	return [
		path.relative(fromDir, path.join(targetPkg.dir, 'src')),
		path.relative(fromDir, targetPkg.dir),
	]
}

function escapeForRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function detectIndent(content: string): string {
	const match = content.match(/^(\s+)"/m)
	return match?.[1] ?? '\t'
}

import * as fs from 'node:fs'
import * as path from 'node:path'
import { minimatch } from '../utils/minimatch.js'
import type { Diagnostic } from './types.js'
import type { ResolvedImport } from '../imports/resolver.js'
import type { ImportRecord } from '../imports/collector.js'
import type { DepsLintPackageConfig } from '../config/types.js'
import { isSubpathExported } from '../exports/resolver.js'

export interface CheckContext {
	packageName: string
	packageDir: string
	rootDir: string
	importedPackages: Set<string>
	resolvedImports: ResolvedImport[]
	dotImports: ImportRecord[]
	allWorkspaceNames: Set<string>
	referencedPackageNames: Set<string>
	hasTsConfig: boolean
	dependencies: Record<string, string>
	peerDependencies: Record<string, string>
	devDependencies: Record<string, string>
	config: DepsLintPackageConfig
}

type Check = (ctx: CheckContext) => Diagnostic[]

const checks: Check[] = [
	checkMissingDependency,
	checkUnusedDependency,
	checkMissingReference,
	checkUnusedReference,
	checkForbiddenDirectoryImport,
	checkForbiddenDotImport,
	checkSelfImport,
	checkTypeOnlyDependency,
	checkDevDependencyInSource,
	checkDuplicateDependency,
	checkMissingPeerDependency,
	checkBannedDependency,
	checkDynamicTypeImport,
	checkEnforceCatalog,
]

export function runChecks(ctx: CheckContext): Diagnostic[] {
	return checks.flatMap(check => check(ctx))
}

// --- existing checks ---

function checkMissingDependency(ctx: CheckContext): Diagnostic[] {
	const diagnostics: Diagnostic[] = []
	const globalModules = new Set(ctx.config.globalModules)

	for (const pkg of ctx.importedPackages) {
		if (globalModules.has(pkg)) continue
		if (ctx.dependencies[pkg] || ctx.peerDependencies[pkg]) continue
		if (ctx.devDependencies[pkg]) continue // handled by dev-dependency-in-source

		diagnostics.push({
			type: 'missing-dependency',
			packageName: ctx.packageName,
			packageDir: ctx.packageDir,
			message: `Module "${pkg}" is imported but missing from package.json dependencies`,
			module: pkg,
		})
	}
	return diagnostics
}

function checkUnusedDependency(ctx: CheckContext): Diagnostic[] {
	const diagnostics: Diagnostic[] = []
	const allowed = new Set(ctx.config.allowedUnusedDependencies)

	for (const dep of Object.keys(ctx.dependencies)) {
		if (allowed.has(dep)) continue
		if (ctx.importedPackages.has(dep)) continue

		diagnostics.push({
			type: 'unused-dependency',
			packageName: ctx.packageName,
			packageDir: ctx.packageDir,
			message: `Module "${dep}" is in dependencies but never imported`,
			module: dep,
		})
	}
	return diagnostics
}

function checkMissingReference(ctx: CheckContext): Diagnostic[] {
	if (!ctx.hasTsConfig) return []
	const diagnostics: Diagnostic[] = []

	for (const pkg of ctx.importedPackages) {
		if (!ctx.allWorkspaceNames.has(pkg)) continue
		if (ctx.referencedPackageNames.has(pkg)) continue

		diagnostics.push({
			type: 'missing-reference',
			packageName: ctx.packageName,
			packageDir: ctx.packageDir,
			message: `Workspace package "${pkg}" is imported but not in tsconfig references`,
			module: pkg,
		})
	}
	return diagnostics
}

function checkUnusedReference(ctx: CheckContext): Diagnostic[] {
	if (!ctx.hasTsConfig) return []
	const diagnostics: Diagnostic[] = []

	for (const ref of ctx.referencedPackageNames) {
		if (ctx.importedPackages.has(ref)) continue

		diagnostics.push({
			type: 'unused-reference',
			packageName: ctx.packageName,
			packageDir: ctx.packageDir,
			message: `Tsconfig reference to "${ref}" is unused (not imported in source)`,
			module: ref,
		})
	}
	return diagnostics
}

function checkForbiddenDirectoryImport(ctx: CheckContext): Diagnostic[] {
	const diagnostics: Diagnostic[] = []
	const allowed = new Set(ctx.config.allowedDirectoryImports)
	const exportsCache = new Map<string, boolean | null>()

	for (const imp of ctx.resolvedImports) {
		if (!imp.hasSubpath || !imp.subpath) continue
		if (allowed.has(imp.fullSpecifier)) continue

		const cacheKey = imp.fullSpecifier
		if (!exportsCache.has(cacheKey)) {
			exportsCache.set(cacheKey, isSubpathExported(imp.packageName, imp.subpath, ctx.rootDir))
		}
		const exported = exportsCache.get(cacheKey)
		if (exported === true) continue

		diagnostics.push({
			type: 'forbidden-directory-import',
			packageName: ctx.packageName,
			packageDir: ctx.packageDir,
			message: `Forbidden directory/file import: "${imp.fullSpecifier}"`,
			file: imp.file,
			module: imp.fullSpecifier,
		})
	}
	return diagnostics
}

function checkForbiddenDotImport(ctx: CheckContext): Diagnostic[] {
	return ctx.dotImports.map(imp => ({
		type: 'forbidden-dot-import' as const,
		packageName: ctx.packageName,
		packageDir: ctx.packageDir,
		message: `Forbidden dot import: "${imp.specifier}"`,
		file: imp.file,
		module: imp.specifier,
	}))
}

// --- new checks ---

function checkSelfImport(ctx: CheckContext): Diagnostic[] {
	const diagnostics: Diagnostic[] = []
	for (const imp of ctx.resolvedImports) {
		if (imp.packageName === ctx.packageName) {
			diagnostics.push({
				type: 'self-import',
				packageName: ctx.packageName,
				packageDir: ctx.packageDir,
				message: `Package imports itself: "${imp.fullSpecifier}"`,
				file: imp.file,
				module: imp.fullSpecifier,
			})
		}
	}
	return diagnostics
}

function checkTypeOnlyDependency(ctx: CheckContext): Diagnostic[] {
	const diagnostics: Diagnostic[] = []

	// Group imports by package name, track if any is non-type-only
	const hasValueImport = new Map<string, boolean>()
	for (const imp of ctx.resolvedImports) {
		if (!ctx.dependencies[imp.packageName]) continue
		const current = hasValueImport.get(imp.packageName) ?? false
		if (!imp.isTypeOnly) {
			hasValueImport.set(imp.packageName, true)
		} else if (!current) {
			hasValueImport.set(imp.packageName, false)
		}
	}

	for (const [pkg, hasValue] of hasValueImport) {
		if (!hasValue) {
			diagnostics.push({
				type: 'type-only-dependency',
				packageName: ctx.packageName,
				packageDir: ctx.packageDir,
				message: `Module "${pkg}" is only used as \`import type\` — consider moving to devDependencies`,
				module: pkg,
			})
		}
	}
	return diagnostics
}

const configFileRe = /(?:^|[/\\])[\w.-]+\.config(?:\.[\w-]+)?\.[cm]?[jt]sx?$/

function checkDevDependencyInSource(ctx: CheckContext): Diagnostic[] {
	const diagnostics: Diagnostic[] = []
	const testPatterns = ctx.config.testPatterns
	const reported = new Set<string>()

	for (const imp of ctx.resolvedImports) {
		if (!ctx.devDependencies[imp.packageName]) continue
		if (ctx.dependencies[imp.packageName] || ctx.peerDependencies[imp.packageName]) continue
		// Type-only imports are fine from devDependencies
		if (imp.isTypeOnly) continue

		const relFile = path.relative(ctx.packageDir, imp.file)
		const isTestFile = testPatterns.some(pattern => minimatch(relFile, pattern))
		if (isTestFile) continue
		// Config files (vite.config.ts, vitest.config.ts, etc.) are dev-only
		if (configFileRe.test(relFile)) continue

		const key = imp.packageName
		if (reported.has(key)) continue
		reported.add(key)

		diagnostics.push({
			type: 'dev-dependency-in-source',
			packageName: ctx.packageName,
			packageDir: ctx.packageDir,
			message: `devDependency "${imp.packageName}" is imported in production source`,
			file: imp.file,
			module: imp.packageName,
		})
	}
	return diagnostics
}

function checkDuplicateDependency(ctx: CheckContext): Diagnostic[] {
	const diagnostics: Diagnostic[] = []
	const deps = Object.keys(ctx.dependencies)
	const peer = new Set(Object.keys(ctx.peerDependencies))
	const dev = new Set(Object.keys(ctx.devDependencies))

	for (const dep of deps) {
		if (peer.has(dep)) {
			diagnostics.push({
				type: 'duplicate-dependency',
				packageName: ctx.packageName,
				packageDir: ctx.packageDir,
				message: `"${dep}" is in both dependencies and peerDependencies`,
				module: dep,
			})
		}
		if (dev.has(dep)) {
			diagnostics.push({
				type: 'duplicate-dependency',
				packageName: ctx.packageName,
				packageDir: ctx.packageDir,
				message: `"${dep}" is in both dependencies and devDependencies`,
				module: dep,
			})
		}
	}
	return diagnostics
}

function checkMissingPeerDependency(ctx: CheckContext): Diagnostic[] {
	const diagnostics: Diagnostic[] = []
	const allDeps = { ...ctx.dependencies, ...ctx.peerDependencies }
	const reported = new Set<string>()

	for (const depName of Object.keys(allDeps)) {
		const depPkgPath = resolveDepPackageJson(depName, ctx.rootDir, ctx.packageDir)
		if (!depPkgPath) continue

		let depPkg: { peerDependencies?: Record<string, string>; peerDependenciesMeta?: Record<string, { optional?: boolean }> }
		try {
			depPkg = JSON.parse(fs.readFileSync(depPkgPath, 'utf-8'))
		} catch {
			continue
		}

		if (!depPkg.peerDependencies) continue

		for (const [peerName, _peerVersion] of Object.entries(depPkg.peerDependencies)) {
			const isOptional = depPkg.peerDependenciesMeta?.[peerName]?.optional === true
			if (isOptional) continue
			if (allDeps[peerName] || ctx.devDependencies[peerName]) continue
			// In monorepos, peer deps may be satisfied by hoisted packages
			if (resolveDepPackageJson(peerName, ctx.rootDir, ctx.packageDir)) continue

			const key = `${depName}:${peerName}`
			if (reported.has(key)) continue
			reported.add(key)

			diagnostics.push({
				type: 'missing-peer-dependency',
				packageName: ctx.packageName,
				packageDir: ctx.packageDir,
				message: `"${depName}" requires peer dependency "${peerName}" which is not installed`,
				module: peerName,
			})
		}
	}
	return diagnostics
}

function resolveDepPackageJson(depName: string, rootDir: string, packageDir: string): string | null {
	const candidates = [
		path.join(packageDir, 'node_modules', depName, 'package.json'),
		path.join(rootDir, 'node_modules', depName, 'package.json'),
	]
	for (const c of candidates) {
		if (fs.existsSync(c)) return c
	}
	return null
}

function checkBannedDependency(ctx: CheckContext): Diagnostic[] {
	const diagnostics: Diagnostic[] = []
	const banned = ctx.config.bannedDependencies

	for (const imp of ctx.resolvedImports) {
		if (banned[imp.packageName]) {
			diagnostics.push({
				type: 'banned-dependency',
				packageName: ctx.packageName,
				packageDir: ctx.packageDir,
				message: `"${imp.packageName}" is banned: ${banned[imp.packageName]}`,
				file: imp.file,
				module: imp.packageName,
			})
		}
	}
	return diagnostics
}

function checkDynamicTypeImport(ctx: CheckContext): Diagnostic[] {
	const diagnostics: Diagnostic[] = []
	for (const imp of ctx.resolvedImports) {
		if (!imp.isImportTypeExpression) continue
		diagnostics.push({
			type: 'dynamic-type-import',
			packageName: ctx.packageName,
			packageDir: ctx.packageDir,
			message: `Dynamic type import \`import('${imp.fullSpecifier}')\` — use \`import type\` instead`,
			file: imp.file,
			module: imp.fullSpecifier,
		})
	}
	return diagnostics
}

function checkEnforceCatalog(ctx: CheckContext): Diagnostic[] {
	const fields = ctx.config.enforceCatalog
	if (fields.length === 0) return []

	const diagnostics: Diagnostic[] = []
	const depFields: Record<string, Record<string, string>> = {
		dependencies: ctx.dependencies,
		devDependencies: ctx.devDependencies,
		peerDependencies: ctx.peerDependencies,
	}

	for (const field of fields) {
		const deps = depFields[field]
		if (!deps) continue

		for (const [name, version] of Object.entries(deps)) {
			if (version.startsWith('workspace:') || version.startsWith('catalog:')) continue

			diagnostics.push({
				type: 'enforce-catalog',
				packageName: ctx.packageName,
				packageDir: ctx.packageDir,
				message: `"${name}": "${version}" in ${field} must use catalog: or workspace: protocol`,
				module: name,
			})
		}
	}
	return diagnostics
}

import type { DepsLintConfig, DepsLintPackageConfig } from './config/types.js'
import type { WorkspacePackage } from './workspace/types.js'
import type { Diagnostic } from './checks/types.js'
import { collectImports } from './imports/collector.js'
import { resolveImports } from './imports/resolver.js'
import { readTsConfig } from './tsconfig/reader.js'
import { resolveReferenceDirs, resolveImportTargetDirs } from './tsconfig/project-resolver.js'
import { runChecks } from './checks/runner.js'
import { defaultConfig } from './config/defaults.js'

const fallbackSourcePatterns = ['**/*.{ts,tsx}']
const fallbackExcludePatterns = ['**/node_modules/**', '**/*.d.ts', '**/generated/**']

export async function analyzePackage(
	pkg: WorkspacePackage,
	allPackages: WorkspacePackage[],
	config: DepsLintConfig,
	rootDir: string,
): Promise<Diagnostic[]> {
	const pkgConfig = resolvePackageConfig(config, pkg.name)
	const isDefaultSourcePatterns = JSON.stringify(pkgConfig.sourcePatterns) === JSON.stringify(defaultConfig.sourcePatterns)

	let records = await collectImports(pkg.dir, pkgConfig.sourcePatterns, pkgConfig.excludePatterns)

	// If default source patterns found nothing, try a broader fallback
	if (records.length === 0 && isDefaultSourcePatterns) {
		records = await collectImports(pkg.dir, fallbackSourcePatterns, fallbackExcludePatterns)
	}
	const tsconfig = await readTsConfig(pkg.dir, pkgConfig.tsconfigPath)
	const tsconfigPaths = tsconfig?.paths ?? {}
	const tsconfigDir = tsconfig?.configDir ?? null

	const { resolved, dotImports } = resolveImports(records, tsconfigPaths)
	const importedPackages = new Set(resolved.map(r => r.packageName))

	const referencedDirs = tsconfig
		? resolveReferenceDirs(tsconfig)
		: new Map<string, string>()

	const importTargetDirs = tsconfigDir
		? resolveImportTargetDirs(records, resolved, allPackages, tsconfigDir, rootDir)
		: new Map<string, string>()

	return runChecks({
		packageName: pkg.name,
		packageDir: pkg.dir,
		rootDir,
		importedPackages,
		resolvedImports: resolved,
		dotImports,
		tsconfigDir,
		referencedDirs,
		importTargetDirs,
		dependencies: pkg.packageJson.dependencies ?? {},
		peerDependencies: pkg.packageJson.peerDependencies ?? {},
		devDependencies: pkg.packageJson.devDependencies ?? {},
		config: pkgConfig,
	})
}

function resolvePackageConfig(config: DepsLintConfig, packageName: string): DepsLintPackageConfig {
	const overrides = config.packageOverrides[packageName]
	if (!overrides) return config
	return { ...config, ...overrides }
}

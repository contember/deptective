import type { DepsLintConfig, DepsLintPackageConfig } from './config/types.js'
import type { WorkspacePackage } from './workspace/types.js'
import type { Diagnostic } from './checks/types.js'
import { collectImports } from './imports/collector.js'
import { resolveImports } from './imports/resolver.js'
import { readTsConfig } from './tsconfig/reader.js'
import { resolveReferencedPackageNames } from './tsconfig/references.js'
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

	const { resolved, dotImports } = resolveImports(records, tsconfigPaths)
	const importedPackages = new Set(resolved.map(r => r.packageName))
	const allWorkspaceNames = new Set(allPackages.map(p => p.name))

	const referencedPackageNames = tsconfig
		? new Set(resolveReferencedPackageNames(tsconfig, allPackages))
		: new Set<string>()

	return runChecks({
		packageName: pkg.name,
		packageDir: pkg.dir,
		rootDir,
		importedPackages,
		resolvedImports: resolved,
		dotImports,
		allWorkspaceNames,
		referencedPackageNames,
		hasTsConfig: tsconfig !== null,
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

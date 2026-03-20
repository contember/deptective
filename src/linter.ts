import type { DepsLintConfig } from './config/types.js'
import type { Diagnostic } from './checks/types.js'
import type { WorkspacePackage } from './workspace/types.js'
import { resolveWorkspacePackages } from './workspace/resolver.js'
import { analyzePackage } from './analyzer.js'
import { runWorkspaceChecks } from './checks/workspace.js'

export interface LintResult {
	diagnostics: Diagnostic[]
	packageCount: number
	allPackages: WorkspacePackage[]
}

export async function lint(cwd: string, config: DepsLintConfig, filter?: string): Promise<LintResult> {
	const allPackages = await resolveWorkspacePackages(cwd)
	const ignoredSet = new Set(config.ignoredPackages)

	const packages = allPackages.filter(pkg => {
		if (ignoredSet.has(pkg.name)) return false
		if (filter && !pkg.name.includes(filter) && !pkg.dir.endsWith(filter)) return false
		return true
	})

	const [perPackageResults, workspaceResults] = await Promise.all([
		Promise.all(packages.map(pkg => analyzePackage(pkg, allPackages, config, cwd))),
		Promise.resolve(runWorkspaceChecks(packages)),
	])

	return {
		diagnostics: [...perPackageResults.flat(), ...workspaceResults],
		packageCount: packages.length,
		allPackages,
	}
}

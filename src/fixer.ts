import type { Diagnostic, DiagnosticType } from './checks/types.js'
import type { WorkspacePackage } from './workspace/types.js'
import type { FixResult } from './checks/rule.js'
import { allRules } from './checks/rules/index.js'

export type { FixAction, FixResult } from './checks/rule.js'

export function isFixable(type: DiagnosticType): boolean {
	return allRules.some(r => r.id === type && r.fix !== undefined)
}

interface ApplyFixesOptions {
	allPackages: WorkspacePackage[]
	rootDir: string
	dryRun?: boolean
}

export function applyFixes(diagnostics: Diagnostic[], opts: ApplyFixesOptions): FixResult {
	const packageIndex = new Map<string, WorkspacePackage>()
	for (const pkg of opts.allPackages) {
		packageIndex.set(pkg.name, pkg)
	}

	const ctx = {
		packageIndex,
		rootDir: opts.rootDir,
		dryRun: opts.dryRun ?? false,
	}

	let fixed = 0
	const actions: import('./checks/rule.js').FixAction[] = []
	const errors: string[] = []

	for (const rule of allRules) {
		if (!rule.fix) continue

		const ruleDiags = diagnostics.filter(d => d.type === rule.id)
		if (ruleDiags.length === 0) continue

		const result = rule.fix(ruleDiags, ctx)
		fixed += result.fixed
		actions.push(...result.actions)
		errors.push(...result.errors)
	}

	return { fixed, actions, errors }
}

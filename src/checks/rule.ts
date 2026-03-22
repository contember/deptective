import type { CheckContext, Diagnostic, DiagnosticType } from './types.js'
import type { WorkspacePackage } from '../workspace/types.js'

export interface FixAction {
	type: DiagnosticType
	packageName: string
	file: string
	description: string
}

export interface FixContext {
	packageIndex: Map<string, WorkspacePackage>
	rootDir: string
	dryRun: boolean
}

export interface FixResult {
	fixed: number
	actions: FixAction[]
	errors: string[]
}

export interface PackageRule {
	id: DiagnosticType
	description: string
	scope: 'package'
	check: (ctx: CheckContext) => Diagnostic[]
	fix?: (diagnostics: Diagnostic[], ctx: FixContext) => FixResult
}

export interface WorkspaceRule {
	id: DiagnosticType
	description: string
	scope: 'workspace'
	check: (packages: WorkspacePackage[]) => Diagnostic[]
	fix?: (diagnostics: Diagnostic[], ctx: FixContext) => FixResult
}

export type Rule = PackageRule | WorkspaceRule

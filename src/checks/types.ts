export type DiagnosticType =
	| 'missing-dependency'
	| 'unused-dependency'
	| 'missing-reference'
	| 'unused-reference'
	| 'forbidden-directory-import'
	| 'forbidden-dot-import'
	| 'self-import'
	| 'type-only-dependency'
	| 'dev-dependency-in-source'
	| 'duplicate-dependency'
	| 'missing-peer-dependency'
	| 'banned-dependency'
	| 'dynamic-type-import'
	| 'enforce-catalog'
	| 'circular-workspace-dependency'
	| 'inconsistent-version'

export interface Diagnostic {
	type: DiagnosticType
	packageName: string
	packageDir: string
	message: string
	file?: string
	module?: string
}

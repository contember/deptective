import type { ResolvedImport } from '../imports/resolver.js'
import type { ImportRecord } from '../imports/collector.js'
import type { DepsLintPackageConfig } from '../config/types.js'

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

export interface CheckContext {
	packageName: string
	packageDir: string
	rootDir: string
	importedPackages: Set<string>
	resolvedImports: ResolvedImport[]
	dotImports: ImportRecord[]
	/** Directory containing the tsconfig file, or null if no tsconfig */
	tsconfigDir: string | null
	/** Resolved tsconfig reference dirs: absoluteDir → original ref path */
	referencedDirs: Map<string, string>
	/** Import target project dirs: absoluteDir → label (package name or relative path) */
	importTargetDirs: Map<string, string>
	dependencies: Record<string, string>
	peerDependencies: Record<string, string>
	devDependencies: Record<string, string>
	config: DepsLintPackageConfig
}

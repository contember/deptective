import type { Diagnostic } from './types.js'
import type { WorkspacePackage } from '../workspace/types.js'
import { workspaceRules } from './rules/index.js'

export function runWorkspaceChecks(packages: WorkspacePackage[]): Diagnostic[] {
	return workspaceRules.flatMap(rule => rule.check(packages))
}

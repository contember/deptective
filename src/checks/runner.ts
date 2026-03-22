import type { CheckContext, Diagnostic } from './types.js'
import { packageRules } from './rules/index.js'

export type { CheckContext }

export function runChecks(ctx: CheckContext): Diagnostic[] {
	return packageRules.flatMap(rule => rule.check(ctx))
}

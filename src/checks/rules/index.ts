import type { Rule, PackageRule, WorkspaceRule } from '../rule.js'
import { missingDependencyRule } from './missing-dependency.js'
import { unusedDependencyRule } from './unused-dependency.js'
import { missingReferenceRule } from './missing-reference.js'
import { unusedReferenceRule } from './unused-reference.js'
import { forbiddenDirectoryImportRule } from './forbidden-directory-import.js'
import { forbiddenDotImportRule } from './forbidden-dot-import.js'
import { selfImportRule } from './self-import.js'
import { typeOnlyDependencyRule } from './type-only-dependency.js'
import { devDependencyInSourceRule } from './dev-dependency-in-source.js'
import { duplicateDependencyRule } from './duplicate-dependency.js'
import { missingPeerDependencyRule } from './missing-peer-dependency.js'
import { bannedDependencyRule } from './banned-dependency.js'
import { dynamicTypeImportRule } from './dynamic-type-import.js'
import { enforceCatalogRule } from './enforce-catalog.js'
import { circularWorkspaceDependencyRule } from './circular-workspace-dependency.js'
import { inconsistentVersionRule } from './inconsistent-version.js'

export const allRules: Rule[] = [
	missingDependencyRule,
	unusedDependencyRule,
	missingReferenceRule,
	unusedReferenceRule,
	forbiddenDirectoryImportRule,
	forbiddenDotImportRule,
	selfImportRule,
	typeOnlyDependencyRule,
	devDependencyInSourceRule,
	duplicateDependencyRule,
	missingPeerDependencyRule,
	bannedDependencyRule,
	dynamicTypeImportRule,
	enforceCatalogRule,
	circularWorkspaceDependencyRule,
	inconsistentVersionRule,
]

export const packageRules = allRules.filter((r): r is PackageRule => r.scope === 'package')
export const workspaceRules = allRules.filter((r): r is WorkspaceRule => r.scope === 'workspace')

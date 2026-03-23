import * as path from 'node:path'
import type { Diagnostic, DiagnosticType } from '../checks/types.js'
import { isFixable } from '../fixer.js'

// ANSI color helpers — disabled when NO_COLOR is set or stdout is not a TTY
const useColor = !process.env['NO_COLOR'] && process.stdout.isTTY

const c = {
	reset: useColor ? '\x1b[0m' : '',
	bold: useColor ? '\x1b[1m' : '',
	dim: useColor ? '\x1b[2m' : '',
	red: useColor ? '\x1b[31m' : '',
	yellow: useColor ? '\x1b[33m' : '',
	green: useColor ? '\x1b[32m' : '',
	cyan: useColor ? '\x1b[36m' : '',
	magenta: useColor ? '\x1b[35m' : '',
	gray: useColor ? '\x1b[90m' : '',
	underline: useColor ? '\x1b[4m' : '',
}

const SEVERITY: Record<string, 'error' | 'warning'> = {
	'missing-dependency': 'error',
	'unused-dependency': 'warning',
	'missing-reference': 'error',
	'unused-reference': 'warning',
	'forbidden-directory-import': 'error',
	'forbidden-dot-import': 'error',
	'self-import': 'error',
	'type-only-dependency': 'warning',
	'dev-dependency-in-source': 'error',
	'duplicate-dependency': 'error',
	'missing-peer-dependency': 'warning',
	'banned-dependency': 'error',
	'dynamic-type-import': 'warning',
	'enforce-catalog': 'warning',
	'extraneous-types-package': 'warning',
	'circular-workspace-dependency': 'error',
	'inconsistent-version': 'warning',
}

function severityIcon(type: DiagnosticType): string {
	const severity = SEVERITY[type] ?? 'error'
	if (!useColor) return severity === 'error' ? 'x' : '!'
	return severity === 'error'
		? `${c.red}x${c.reset}`
		: `${c.yellow}!${c.reset}`
}

function formatFilePath(file: string, cwd: string): string {
	const rel = path.relative(cwd, file)
	return `${c.dim}${rel}${c.reset}`
}

export function formatText(diagnostics: Diagnostic[], cwd?: string): string {
	if (diagnostics.length === 0) return ''
	const baseCwd = cwd ?? process.cwd()

	const grouped = new Map<string, Diagnostic[]>()
	for (const d of diagnostics) {
		const key = d.packageName
		if (!grouped.has(key)) grouped.set(key, [])
		grouped.get(key)!.push(d)
	}

	const lines: string[] = []
	for (const [pkg, diags] of grouped) {
		lines.push(`${c.bold}${c.underline}${pkg}${c.reset}`)
		for (const d of diags.sort((a, b) => a.type.localeCompare(b.type) || a.message.localeCompare(b.message))) {
			const icon = severityIcon(d.type)
			const rule = `${c.dim}${d.type}${c.reset}`
			const fixable = isFixable(d.type) ? ` ${c.cyan}(fixable)${c.reset}` : ''
			const fileInfo = d.file ? `  ${formatFilePath(d.file, baseCwd)}` : ''
			lines.push(`  ${icon} ${d.message} ${rule}${fixable}${fileInfo}`)
		}
		lines.push('')
	}

	return lines.join('\n')
}

export function formatJson(diagnostics: Diagnostic[]): string {
	return JSON.stringify(diagnostics, null, 2)
}

export function formatSummary(count: number, packageCount: number): string {
	if (count === 0) {
		return `${c.green}${c.bold}No issues found${c.reset} ${c.dim}(checked ${packageCount} package${packageCount === 1 ? '' : 's'})${c.reset}`
	}
	const label = count === 1 ? 'issue' : 'issues'
	const pkgLabel = packageCount === 1 ? 'package' : 'packages'
	return `${c.red}${c.bold}${count} ${label}${c.reset} ${c.dim}in ${packageCount} ${pkgLabel}${c.reset}`
}

export function formatFixSummary(fixed: number, dryRun?: boolean): string {
	if (dryRun) {
		return `${c.cyan}Would fix ${fixed} issue${fixed === 1 ? '' : 's'}.${c.reset} Run with ${c.bold}--fix${c.reset} to apply.`
	}
	return `${c.green}Fixed ${fixed} issue${fixed === 1 ? '' : 's'}.${c.reset}`
}

export function formatFixAction(description: string): string {
	return `  ${c.cyan}~${c.reset} ${description}`
}

export function formatError(message: string): string {
	return `  ${c.red}error${c.reset} ${message}`
}

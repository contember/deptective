import type { Diagnostic } from '../checks/types.js'

export function formatText(diagnostics: Diagnostic[]): string {
	if (diagnostics.length === 0) return ''

	const grouped = new Map<string, Diagnostic[]>()
	for (const d of diagnostics) {
		const key = d.packageName
		if (!grouped.has(key)) grouped.set(key, [])
		grouped.get(key)!.push(d)
	}

	const lines: string[] = []
	for (const [pkg, diags] of grouped) {
		lines.push(pkg)
		for (const d of diags.sort((a, b) => a.type.localeCompare(b.type) || a.message.localeCompare(b.message))) {
			const fileInfo = d.file ? ` (${d.file})` : ''
			lines.push(`  ${d.type}: ${d.message}${fileInfo}`)
		}
		lines.push('')
	}

	return lines.join('\n')
}

export function formatJson(diagnostics: Diagnostic[]): string {
	return JSON.stringify(diagnostics, null, 2)
}

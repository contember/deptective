/**
 * Simple glob matching for file paths.
 * Supports: *, **, ?
 */
export function minimatch(filePath: string, pattern: string): boolean {
	const regex = patternToRegex(pattern)
	return regex.test(filePath)
}

function patternToRegex(pattern: string): RegExp {
	let regex = ''
	let i = 0
	while (i < pattern.length) {
		const c = pattern[i]
		if (c === '*' && pattern[i + 1] === '*') {
			if (pattern[i + 2] === '/') {
				regex += '(?:.*/)?' // **/ matches zero or more directories
				i += 3
			} else {
				regex += '.*' // ** at end matches everything
				i += 2
			}
		} else if (c === '*') {
			regex += '[^/]*'
			i++
		} else if (c === '?') {
			regex += '[^/]'
			i++
		} else if (c === '.') {
			regex += '\\.'
			i++
		} else {
			regex += c
			i++
		}
	}
	return new RegExp(`^${regex}$`)
}

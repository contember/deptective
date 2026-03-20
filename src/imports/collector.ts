import glob from 'fast-glob'
import * as fs from 'node:fs/promises'
import ts from 'typescript'

export interface ImportRecord {
	specifier: string
	file: string
	isTypeOnly: boolean
	/** import('Foo').Bar in type position */
	isImportTypeExpression: boolean
}

export async function collectImports(packageDir: string, sourcePatterns: string[], excludePatterns: string[]): Promise<ImportRecord[]> {
	const patterns = sourcePatterns.map(p => `${packageDir}/${p}`)
	const ignore = excludePatterns.map(p => `${packageDir}/${p}`)
	const files = await glob(patterns, { onlyFiles: true, ignore })

	const records: ImportRecord[] = []

	await Promise.all(files.map(async file => {
		const content = await fs.readFile(file, 'utf-8')
		const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.ESNext)

		const visit = (node: ts.Node) => {
			// import ... from 'specifier'  /  import type ... from 'specifier'
			if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
				records.push({
					specifier: node.moduleSpecifier.text,
					file,
					isTypeOnly: node.importClause?.isTypeOnly ?? false,
					isImportTypeExpression: false,
				})
			}
			// export ... from 'specifier'  /  export type ... from 'specifier'
			if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
				records.push({
					specifier: node.moduleSpecifier.text,
					file,
					isTypeOnly: node.isTypeOnly,
					isImportTypeExpression: false,
				})
			}
			// import('Foo').Bar in type position
			if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
				records.push({
					specifier: node.argument.literal.text,
					file,
					isTypeOnly: true,
					isImportTypeExpression: true,
				})
			}
			// dynamic import('specifier') and require('specifier')
			if (ts.isCallExpression(node)) {
				const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
				const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'

				if ((isDynamicImport || isRequire) && node.arguments.length >= 1 && ts.isStringLiteral(node.arguments[0])) {
					records.push({
						specifier: node.arguments[0].text,
						file,
						isTypeOnly: false,
						isImportTypeExpression: false,
					})
				}
			}
			ts.forEachChild(node, visit)
		}
		ts.forEachChild(sourceFile, visit)
	}))

	return records
}

import ts from 'typescript';
import path from 'path';
import type { GenericOverride, GenericOverrideMap, GenericOverrideNodeType } from './config';

const { factory, SyntaxKind } = ts;

export function getRelativePath(source: string, target: string) {
  const targetArr = target.split('/');
  const sourceArr = source.split('/');
  // Remove filename from end of source & target, discard source
  sourceArr.pop();
  const targetFileName = targetArr.pop();

  const relativePath = path.relative(sourceArr.join('/'), targetArr.join('/'));

  return (relativePath ? `${relativePath}/${targetFileName}` : `./${targetFileName}`).replaceAll(path.sep, '/');
}

export function getImportPath(toDir: string, toFileName: string, fromDir: string, fromFileName: string) {
  let aPath = path.join(toDir, toFileName).replaceAll(path.sep, '/');
  let bPath = path.join(fromDir || './', fromFileName || 'index.ts').replaceAll(path.sep, '/');

  if (toDir.startsWith('./') && !aPath.startsWith('.')) {
    aPath = `./${aPath}`;
  }

  if (fromDir.startsWith('./') && !bPath.startsWith('.')) {
    bPath = `./${bPath}`;
  }

  const relativePath = getRelativePath(bPath, aPath).replaceAll('index', '').replace(/\.ts$/, '');

  if (relativePath.endsWith('/')) {
    return relativePath.slice(0, -1);
  }

  return relativePath;
}

export function createImportDeclaration(
  importPath: string,
  namedImports: string[] | undefined,
  typeOnlyNamedImports?: string[],
  defaultImport?: string,
) {
  const isFullyTypeOnly = Boolean(
    namedImports?.length && namedImports.every((namedImport) => typeOnlyNamedImports?.includes(namedImport)),
  );

  return factory.createImportDeclaration(
    undefined,
    factory.createImportClause(
      isFullyTypeOnly,
      defaultImport ? factory.createIdentifier(defaultImport) : undefined,
      namedImports?.length
        ? factory.createNamedImports(
            namedImports.map((namedImport) =>
              factory.createImportSpecifier(
                Boolean(isFullyTypeOnly ? false : typeOnlyNamedImports?.includes(namedImport)),
                undefined,
                factory.createIdentifier(namedImport),
              ),
            ),
          )
        : undefined,
    ),
    factory.createStringLiteral(importPath, true),
  );
}

export function getAllGenericsForChildren(generics: GenericOverrideMap | undefined): GenericOverride[] {
  const overrides = new Set<GenericOverride>();
  const queue = generics ? Array.from(generics || []) : [];
  const visited = new Set<GenericOverrideMap>();

  while (queue.length) {
    const [_, prospect] = queue.shift()!;

    if (prospect instanceof Map) {
      if (!visited.has(prospect)) {
        visited.add(prospect);
        queue.push(...Array.from(prospect));
      }
    } else {
      overrides.add(prospect);
    }
  }

  return Array.from(overrides);
}

export function buildGenericReferenceNode(nodeType: GenericOverrideNodeType | ts.TypeNode): ts.TypeNode {
  switch (nodeType) {
    case 'string':
      return factory.createKeywordTypeNode(SyntaxKind.StringKeyword);
    case 'number':
      return factory.createKeywordTypeNode(SyntaxKind.NumberKeyword);
    case 'boolean':
      return factory.createKeywordTypeNode(SyntaxKind.BooleanKeyword);
    case 'object':
      return factory.createKeywordTypeNode(SyntaxKind.ObjectKeyword);
    case 'any':
      return factory.createKeywordTypeNode(SyntaxKind.AnyKeyword);
    case 'unknown':
      return factory.createKeywordTypeNode(SyntaxKind.UnknownKeyword);
    case 'undefined':
      return factory.createKeywordTypeNode(SyntaxKind.UndefinedKeyword);
    default:
      return typeof nodeType === 'object' ? nodeType : factory.createTypeReferenceNode(nodeType);
  }
}

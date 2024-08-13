import ts from 'typescript';
import path from 'path';
import { match, P } from 'ts-pattern';
import type { GenericOverride, GenericOverrideMap, GenericOverrideNodeType } from './config';
import type { ParsedObjectProperty, ParsedRef, ParsedSchema, ParsedSchemaWithRef } from './parsed-types';
import { GeneratedSchema, PackageSummary } from './generated-types';

const { factory, SyntaxKind } = ts;

export const JSON_SCHEMA_REFERENCE_PREFIX = '#/schemas/';

export function cleanRefName(ref: ParsedRef) {
  return ref.$ref.replace(JSON_SCHEMA_REFERENCE_PREFIX, '');
}

export function getSchemaName(schema: ParsedSchemaWithRef | undefined, schemas: Map<string, ParsedSchema>): string {
  return match(schema)
    .with({ object: P.not(P.nullish) }, (s) => s.object.name)
    .with({ enum: P.not(P.nullish) }, (s) => s.enum.name)
    .with({ oneOf: P.not(P.nullish) }, (s) => s.oneOf.name)
    .with({ $ref: P.not(P.nullish) }, (s) => getSchemaName(schemas.get(cleanRefName(s)), schemas))
    .with({ array: P.not(P.nullish) }, (s) => getSchemaName(s.array.itemSchema, schemas))
    .otherwise(() => '');
}

export function getFullGRPCName(schema: ParsedSchemaWithRef | undefined): string {
  return match(schema)
    .with({ object: P.not(P.nullish) }, (s) => s.object.fullGrpcName)
    .with({ enum: P.not(P.nullish) }, (s) => s.enum.fullGrpcName)
    .with({ oneOf: P.not(P.nullish) }, (s) => s.oneOf.fullGrpcName)
    .with({ array: P.not(P.nullish) }, (s) => getFullGRPCName(s.array.itemSchema))
    .with({ $ref: P.not(P.nullish) }, (s) => cleanRefName(s))
    .otherwise(() => '');
}

export function getPackageSummary(schema: ParsedSchemaWithRef | undefined): PackageSummary | undefined {
  return match(schema)
    .with({ object: P.not(P.nullish) }, (s) => s.object.package)
    .with({ enum: P.not(P.nullish) }, (s) => s.enum.package)
    .with({ oneOf: P.not(P.nullish) }, (s) => s.oneOf.package)
    .with({ array: P.not(P.nullish) }, (s) => getPackageSummary(s.array.itemSchema))
    .otherwise(() => undefined);
}

export function getGeneratedSchemasForPackage(
  fullGrpcPackageName: string,
  generatedSchemas: Map<string, GeneratedSchema>,
) {
  return Array.from(generatedSchemas.values()).filter(
    (schema) => schema.parentPackage?.package === fullGrpcPackageName,
  );
}

export function getObjectProperties(
  schema: ParsedSchemaWithRef | undefined,
  schemas: Map<string, ParsedSchema> = new Map(),
): Map<string, ParsedObjectProperty> | undefined {
  return match(schema)
    .with({ object: P.not(P.nullish) }, (s) => s.object.properties)
    .with({ oneOf: P.not(P.nullish) }, (s) => s.oneOf.properties)
    .with({ $ref: P.not(P.nullish) }, (s) => getObjectProperties(schemas.get(cleanRefName(s)), schemas))
    .with({ array: P.not(P.nullish) }, (s) => getObjectProperties(s.array.itemSchema, schemas))
    .with({ map: P.not(P.nullish) }, (s) => {
      const itemMap = getObjectProperties(s.map.itemSchema, schemas);
      const keyMap = getObjectProperties(s.map.keySchema, schemas);

      if (itemMap || keyMap) {
        return new Map([...(itemMap || new Map()), ...(keyMap || new Map())]);
      }

      return undefined;
    })
    .otherwise(() => undefined);
}

export function isCharacterSafeForName(char: string) {
  return char.match(/\p{Letter}|[0-9]|\$|_/u);
}

export function isKeyword(rawName: string) {
  try {
    new Function('var ' + rawName + ';');
    return false;
  } catch {
    return true;
  }
}

export function isKeyNameValid(rawName: string) {
  // If the first character is a number, it's invalid
  if (!Number.isNaN(Number(rawName[0]))) {
    return false;
  }

  // If the name contains an unsupported character, it's invalid
  for (const char of rawName) {
    if (!isCharacterSafeForName(char)) {
      return false;
    }
  }

  return true;
}

export function getValidKeyName(rawName: string) {
  return isKeyNameValid(rawName) ? rawName : `'${rawName}'`;
}

export function getRelativePath(source: string, target: string) {
  const targetArr = target.split('/');
  const sourceArr = source.split('/');
  // Remove filename from end of source & target, discard source
  sourceArr.pop();
  const targetFileName = targetArr.pop();

  const relativePath = path.relative(sourceArr.join('/'), targetArr.join('/'));

  return (relativePath ? `${relativePath}/${targetFileName}` : `./${targetFileName}`).replaceAll(path.sep, '/');
}

export function getImportPath(
  toDir: string,
  toFileName: string,
  fromDir: string,
  fromFileName: string,
  extensionMatcher: RegExp | string = /\.ts$/,
) {
  let aPath = path.join(toDir, toFileName).replaceAll(path.sep, '/');
  let bPath = path.join(fromDir || './', fromFileName || 'index.ts').replaceAll(path.sep, '/');

  if (toDir.startsWith('./') && !aPath.startsWith('.')) {
    aPath = `./${aPath}`;
  }

  if (fromDir.startsWith('./') && !bPath.startsWith('.')) {
    bPath = `./${bPath}`;
  }

  const relativePath = getRelativePath(bPath, aPath).replaceAll('index', '').replace(extensionMatcher, '');

  if (relativePath.endsWith('/')) {
    return relativePath.slice(0, -1);
  }

  return relativePath;
}

export function createExportDeclaration(namedExports: string[]) {
  return factory.createExportDeclaration(
    undefined,
    false,
    factory.createNamedExports(
      namedExports.map((namedExport) =>
        factory.createExportSpecifier(false, undefined, factory.createIdentifier(namedExport)),
      ),
    ),
  );
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

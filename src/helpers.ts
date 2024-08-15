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

export type ImportPathNameCleaner = (name: string) => string;

const defaultImportPathNameCleaner: ImportPathNameCleaner = (name) => {
  const fileExt = path.extname(name);

  let returnName = name;
  if (['.js', '.mjs', '.jsx', '.ts', '.tsx'].includes(fileExt)) {
    returnName = name.slice(0, -fileExt.length);
  }

  if (returnName.endsWith('/index')) {
    returnName = returnName.replace(/\/index$/, '');
  }

  return returnName;
};

export function getImportPath(
  toDir: string,
  toFileName: string,
  fromDir: string,
  fromFileName: string,
  pathNameCleaner: ImportPathNameCleaner = defaultImportPathNameCleaner,
) {
  let aPath = path.join(toDir, toFileName).replaceAll(path.sep, '/');
  let bPath = path.join(fromDir || './', fromFileName || 'index.ts').replaceAll(path.sep, '/');

  if (toDir.startsWith('./') && !aPath.startsWith('.')) {
    aPath = `./${aPath}`;
  }

  if (fromDir.startsWith('./') && !bPath.startsWith('.')) {
    bPath = `./${bPath}`;
  }

  let relativePath = pathNameCleaner(getRelativePath(bPath, aPath));

  if (!relativePath.startsWith('.')) {
    relativePath = `./${relativePath}`;
  }

  if (relativePath.endsWith('/')) {
    relativePath = relativePath.slice(0, -1);
  }

  return relativePath;
}

export type NodeTest = (node: ts.Node) => boolean;

export const isTypeScriptNode: NodeTest = (node: any) => {
  if (
    !node ||
    typeof node !== 'object' ||
    !Object.hasOwnProperty.call(node, 'kind') ||
    ts.SyntaxKind[node.kind] === undefined ||
    !Object.hasOwnProperty.call(node, 'flags') ||
    ts.NodeFlags[node.flags] === undefined
  ) {
    return false;
  }

  return true;
};

const defaultTypeScriptIsChecks: NodeTest[] = [isTypeScriptNode];

export function createExpression(value: any, nodeTests: NodeTest[] = defaultTypeScriptIsChecks): ts.Expression {
  if (typeof value === 'string') {
    return factory.createStringLiteral(value, true);
  }

  if (typeof value === 'number') {
    if (value.toString().charAt(0) === '-') {
      return factory.createPrefixUnaryExpression(
        ts.SyntaxKind.MinusToken,
        factory.createNumericLiteral(Math.abs(value)),
      );
    }

    return factory.createNumericLiteral(value);
  }

  if (typeof value === 'boolean') {
    return value ? factory.createTrue() : factory.createFalse();
  }

  if (Array.isArray(value)) {
    return factory.createArrayLiteralExpression(
      value.map((item) => createExpression(item, nodeTests)),
      true,
    );
  }

  if (value === null) {
    return factory.createNull();
  }

  if (typeof value === 'object') {
    if (nodeTests.some((test) => test(value))) {
      return value;
    }

    return createObjectLiteral(value, nodeTests);
  }

  if (typeof value === 'undefined') {
    return factory.createIdentifier('undefined');
  }

  throw new Error(`Unsupported value type: ${typeof value}`);
}

export function createObjectLiteral(
  obj: any,
  nodeTests: NodeTest[] = defaultTypeScriptIsChecks,
): ts.ObjectLiteralExpression {
  const properties: ts.ObjectLiteralElementLike[] = [];

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      properties.push(
        factory.createPropertyAssignment(factory.createIdentifier(key), createExpression(obj[key], nodeTests)),
      );
    }
  }

  return factory.createObjectLiteralExpression(properties, true);
}

export function generatedSchemaMapToParsedSchemaMap(
  generatedSchemas: Map<string, GeneratedSchema>,
): Map<string, ParsedSchema> {
  const parsedSchemas = new Map<string, ParsedSchema>();

  for (const [key, value] of generatedSchemas) {
    parsedSchemas.set(key, value.rawSchema);
  }

  return parsedSchemas;
}

export function getPropertyByPath(
  path: string,
  schema: ParsedSchemaWithRef,
  schemas: Map<string, ParsedSchema>,
): ParsedSchema | undefined {
  const parts = path.split('.');
  let currentPart = parts.shift();
  let currentSchema = schema;

  while (currentPart) {
    const properties = getObjectProperties(currentSchema, schemas);

    if (!properties) {
      return undefined;
    }

    if (!properties.has(currentPart)) {
      return undefined;
    }

    currentSchema = properties.get(currentPart)!.schema;
    currentPart = parts.shift();
  }

  return match(currentSchema)
    .with({ $ref: P.not(P.nullish) }, (s) => schemas.get(cleanRefName(s)))
    .otherwise(() => currentSchema as ParsedSchema);
}

export function createNamedExportDeclaration(
  exportPath: string | undefined,
  namedExports: string[],
  typeOnlyExports?: string[],
) {
  const isFullyTypeOnly = Boolean(
    namedExports?.length && namedExports.every((namedExport) => typeOnlyExports?.includes(namedExport)),
  );

  return factory.createExportDeclaration(
    undefined,
    isFullyTypeOnly,
    factory.createNamedExports(
      namedExports.map((namedExport) =>
        factory.createExportSpecifier(
          Boolean(isFullyTypeOnly ? false : typeOnlyExports?.includes(namedExport)),
          undefined,
          factory.createIdentifier(namedExport),
        ),
      ),
    ),
    exportPath ? factory.createStringLiteral(exportPath, true) : undefined,
  );
}

export function createImportDeclaration(
  importPath: string,
  namedImports: string[] | undefined,
  typeOnlyNamedImports?: string[],
  defaultImport?: string,
) {
  const isFullyTypeOnly = Boolean(
    !defaultImport &&
      namedImports?.length &&
      namedImports.every((namedImport) => typeOnlyNamedImports?.includes(namedImport)),
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

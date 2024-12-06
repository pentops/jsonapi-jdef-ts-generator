import {
  factory,
  SyntaxKind,
  NodeFlags,
  type Expression,
  type PropertyAccessExpression,
  type Node,
  type ObjectLiteralExpression,
  type ObjectLiteralElementLike,
  type TypeNode,
} from 'typescript';
import type { GenericOverrideNodeType } from './config-types';

export function createLogicalAndChain(expressions: Expression[]) {
  let logicalAnd: Expression | undefined;

  expressions.forEach((expression) => {
    if (!logicalAnd) {
      logicalAnd = expression;
    } else {
      logicalAnd = factory.createLogicalAnd(logicalAnd, expression);
    }
  });

  return logicalAnd;
}

export interface PropertyAccessPart {
  name: string;
  optional: boolean;
}

export function createPropertyAccessChain(accessor: string, accessorIsOptional: boolean, parts: PropertyAccessPart[]) {
  let accessChain: PropertyAccessExpression | undefined;

  parts.forEach((part, i) => {
    if (!accessChain) {
      accessChain = factory.createPropertyAccessChain(
        factory.createIdentifier(accessor),
        accessorIsOptional ? factory.createToken(SyntaxKind.QuestionDotToken) : undefined,
        part.name,
      );
    } else {
      accessChain = factory.createPropertyAccessChain(
        accessChain,
        parts[i - 1]?.optional ? factory.createToken(SyntaxKind.QuestionDotToken) : undefined,
        part.name,
      );
    }
  });

  return accessChain;
}

export type NodeTest = (node: Node) => boolean;

export const isTypeScriptNode: NodeTest = (node: any) => {
  if (
    !node ||
    typeof node !== 'object' ||
    !Object.hasOwnProperty.call(node, 'kind') ||
    SyntaxKind[node.kind] === undefined ||
    !Object.hasOwnProperty.call(node, 'flags') ||
    NodeFlags[node.flags] === undefined
  ) {
    return false;
  }

  return true;
};

const defaultTypeScriptIsChecks: NodeTest[] = [isTypeScriptNode];

export function createExpression(value: any, nodeTests: NodeTest[] = defaultTypeScriptIsChecks): Expression {
  if (typeof value === 'string') {
    return factory.createStringLiteral(value, true);
  }

  if (typeof value === 'number') {
    if (value.toString().charAt(0) === '-') {
      return factory.createPrefixUnaryExpression(SyntaxKind.MinusToken, factory.createNumericLiteral(Math.abs(value)));
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
): ObjectLiteralExpression {
  const properties: ObjectLiteralElementLike[] = [];

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      properties.push(
        factory.createPropertyAssignment(factory.createIdentifier(key), createExpression(obj[key], nodeTests)),
      );
    }
  }

  return factory.createObjectLiteralExpression(properties, true);
}

export function createNamedExportDeclaration(
  exportPath: string | undefined,
  namedExports: string[],
  typeOnlyExports?: string[],
) {
  const isFullyTypeOnly = Boolean(
    namedExports?.length && namedExports.every((namedExport) => typeOnlyExports?.includes(namedExport)),
  );

  namedExports?.sort();

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

  namedImports?.sort();

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

export function buildGenericReferenceNode(nodeType: GenericOverrideNodeType | TypeNode): TypeNode {
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

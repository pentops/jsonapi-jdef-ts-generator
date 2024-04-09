import ts, { type Expression, Identifier, type TypeElement, type TypeLiteralNode, type TypeNode } from 'typescript';
import { match, P } from 'ts-pattern';
import { pascalCase } from 'change-case';
import { API, EnumItem, MapItem, Method, ObjectSchema, Parameter, Schema, SchemaWithRef } from './jdef-types';
import { Config } from './config';
import path from 'path';
import { buildMergedRequestInit, buildSplitRequestInit, makeRequest } from '@pentops/jsonapi-request';

const {
  addSyntheticLeadingComment,
  addSyntheticTrailingComment,
  createPrinter,
  createSourceFile,
  factory,
  ListFormat,
  NewLineKind,
  ScriptKind,
  ScriptTarget,
  SyntaxKind,
} = ts;

const REQUEST_LIBRARY_NAME = '@pentops/jsonapi-request';
const REQUEST_SUFFIX = 'Request';
const RESPONSE_SUFFIX = 'Response';
const PATH_PARAMETERS_SUFFIX = 'PathParameters';
const QUERY_PARAMETERS_SUFFIX = 'QueryParameters';
const REQUEST_INIT_PARAMETER_NAME = 'requestInit';

const optionalFieldMarker = factory.createToken(SyntaxKind.QuestionToken);

function getRelativePath(source: string, target: string) {
  const targetArr = target.split('/');
  const sourceArr = source.split('/');
  // Remove filename from end of source & target, discard source
  sourceArr.pop();
  const targetFileName = targetArr.pop();

  const relativePath = path.relative(sourceArr.join('/'), targetArr.join('/'));

  return (relativePath ? `${relativePath}/${targetFileName}` : `./${targetFileName}`).replaceAll(path.sep, '/');
}

function isCharacterSafeForName(char: string) {
  return char.match(/\p{Letter}|[0-9]|\$|_/u);
}

function isKeyword(rawName: string) {
  return [
    'abstract',
    'as',
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'debugger',
    'declare',
    'default',
    'delete',
    'do',
    'else',
    'enum',
    'export',
    'extends',
    'false',
    'finally',
    'for',
    'from',
    'function',
    'get',
    'if',
    'implements',
    'import',
    'in',
    'instanceof',
    'interface',
    'let',
    'module',
    'namespace',
    'new',
    'null',
    'package',
    'private',
    'protected',
    'public',
    'readonly',
    'require',
    'global',
    'return',
    'set',
    'static',
    'super',
    'switch',
    'symbol',
    'this',
    'throw',
    'true',
    'try',
    'type',
    'typeof',
    'undefined',
    'var',
    'void',
    'while',
    'with',
    'yield',
  ].includes(rawName);
}

export class Generator {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  private isKeyNameValid(rawName: string) {
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

  private getValidTypeName(schema: Schema, ...backupValues: string[]) {
    let value = (schema as ObjectSchema)?.['x-proto-full-name'] || '';

    while (!value && backupValues.length) {
      value = backupValues.shift() || '';
    }

    if (!value) {
      return '';
    }

    let output = this.config.types.nameWriter(value);

    if (!output) {
      console.warn(`[jdef-ts-generator]: unable to generate a valid type name for ${value}`);
    }

    if (!Number.isNaN(Number(output[0])) || isKeyword(output)) {
      output = `_${output}`;
    }

    const splitOutput = output.split('');
    for (let i = 0; i < splitOutput.length; i++) {
      if (!isCharacterSafeForName(splitOutput[i])) {
        splitOutput[i] = '_';
      }
    }

    return output;
  }

  private getValidKeyName(rawName: string) {
    return this.isKeyNameValid(rawName) ? rawName : `'${rawName}'`;
  }

  private buildUnionEnum(schema: EnumItem) {
    return factory.createUnionTypeNode(
      schema.enum.map((value) => factory.createLiteralTypeNode(factory.createStringLiteral(value, true))),
    );
  }

  private buildBaseType(schema: SchemaWithRef): { node: TypeNode; comment?: string } {
    return (
      match(schema)
        .with({ type: 'boolean' }, () => ({ node: factory.createTypeReferenceNode('boolean') }))
        // all nested enums are union types
        .with({ enum: P.array(P.string) }, (s) => ({ node: this.buildUnionEnum(s) }))
        .with({ type: 'string' }, (s) => ({
          node: factory.createKeywordTypeNode(SyntaxKind.StringKeyword),
          comment:
            [s.format ? `format: ${s.format}` : undefined, s.pattern ? `pattern: ${s.pattern}` : undefined]
              .filter(Boolean)
              .join(', ') || undefined,
        }))
        .with({ type: P.union('number', 'integer') }, (s) => ({
          node: s.format?.endsWith('64')
            ? factory.createKeywordTypeNode(SyntaxKind.StringKeyword)
            : factory.createTypeReferenceNode('number'),
          comment: s.format ? `format: ${s.format}` : undefined,
        }))
        .with({ $ref: P.not(P.nullish) }, (s) => ({
          node: factory.createTypeReferenceNode(this.getValidTypeName({ 'x-proto-full-name': s.$ref } as Schema)),
        }))
        .with({ type: 'object' }, (s) => ({ node: this.buildObject(s) }))
        .with({ type: 'array' }, (s) => {
          const { node, comment } = this.buildBaseType(s.items);

          return { node: factory.createArrayTypeNode(node), comment };
        })
        .otherwise(() => ({ node: factory.createTypeReferenceNode('any') }))
    );
  }

  private buildMapType(schema: MapItem) {
    return factory.createTypeReferenceNode('Record', [
      this.buildBaseType(schema['x-key-property']).node,
      this.buildBaseType(schema.additionalProperties).node,
    ]);
  }

  private buildObject(schema: ObjectSchema) {
    if (schema.additionalProperties && schema['x-key-property']) {
      return this.buildMapType({
        'additionalProperties': schema.additionalProperties,
        'x-key-property': schema['x-key-property'],
      });
    }

    const members: (TypeElement | Identifier)[] = [];
    const isOneOf = schema['x-is-oneof'] === true;
    const entries = Object.entries(schema.properties || {});

    entries.forEach(([name, property], i) => {
      const { node, comment } = this.buildBaseType(property);

      let member = factory.createPropertySignature(
        undefined,
        this.getValidKeyName(name),
        schema.required?.includes(name) ? undefined : optionalFieldMarker,
        node,
      );

      if (comment) {
        member = addSyntheticLeadingComment(member, SyntaxKind.SingleLineCommentTrivia, ` ${comment}`, true);
      }

      // Add a comment before the first member for oneOfs
      if (isOneOf && i === 0) {
        if (i === 0) {
          member = addSyntheticLeadingComment(member, SyntaxKind.SingleLineCommentTrivia, ' start oneOf', false);
        }
      }

      members.push(member);

      if (isOneOf && i === entries.length - 1) {
        // A little hack to make a comment actually trail the last member of a oneOf
        members.push(
          addSyntheticTrailingComment(
            factory.createIdentifier(''),
            SyntaxKind.SingleLineCommentTrivia,
            ' end oneOf',
            false,
          ),
        );
      }
    });

    return factory.createTypeLiteralNode(members as readonly TypeElement[]);
  }

  private generateSchema(keyName: string, schema: SchemaWithRef) {
    const generatedName = this.getValidTypeName(schema as Schema, keyName);

    if (!generatedName) {
      return;
    }

    return match(schema)
      .with({ type: 'object' }, (s) =>
        match(s)
          .with({ 'additionalProperties': P.not(P.nullish), 'x-key-property': P.not(P.nullish) }, (m) =>
            this.buildMapType(m),
          )
          .otherwise(() =>
            factory.createInterfaceDeclaration(
              [factory.createModifier(SyntaxKind.ExportKeyword)],
              factory.createIdentifier(generatedName),
              [],
              [],
              (this.buildObject(s) as TypeLiteralNode)?.members,
            ),
          ),
      )
      .with({ 'enum': P.array(P.string), 'x-enum': P.not(P.nullish) }, (s) => {
        return match(this.config.types.enumType)
          .with('union', () =>
            factory.createTypeAliasDeclaration(
              [factory.createModifier(SyntaxKind.ExportKeyword)],
              factory.createIdentifier(generatedName),
              [],
              this.buildUnionEnum(s),
            ),
          )
          .with('enum', () =>
            factory.createEnumDeclaration(
              [factory.createModifier(SyntaxKind.ExportKeyword)],
              factory.createIdentifier(generatedName),
              s.enum.map((value) =>
                factory.createEnumMember(
                  factory.createIdentifier(this.getValidKeyName(pascalCase(value))),
                  factory.createStringLiteral(value, true),
                ),
              ),
            ),
          )
          .exhaustive();
      })
      .otherwise(() => this.buildBaseType(schema).node);
  }

  private parametersToSchema(parameters: Parameter[]) {
    const schema: SchemaWithRef = { type: 'object', properties: {} };

    for (const parameter of parameters) {
      if (parameter.schema) {
        schema.properties![parameter.name] = parameter.schema;
      }
    }

    return schema;
  }

  private getMethodNames(method: Method) {
    const responseBodyName = this.getValidTypeName(
      method.responseBody as Schema,
      `${method.fullGrpcName.replaceAll('/', '')}${RESPONSE_SUFFIX}`,
      `${method.grpcMethodName}${RESPONSE_SUFFIX}`,
    );

    const requestBaseFirstPriorityBackup = responseBodyName?.endsWith(RESPONSE_SUFFIX)
      ? responseBodyName?.replace(RESPONSE_SUFFIX, REQUEST_SUFFIX)
      : `${method.fullGrpcName.replaceAll('/', '')}${REQUEST_SUFFIX}`;
    const requestBodyBaseName = this.getValidTypeName(
      method.requestBody as Schema,
      requestBaseFirstPriorityBackup,
      `${method.grpcMethodName}${REQUEST_SUFFIX}`,
    );

    return match(this.config.types.requestType)
      .with('merged', () => ({
        responseBody: method.responseBody ? responseBodyName : '',
        requestBody: method.requestBody || method.queryParameters || method.pathParameters ? requestBodyBaseName : '',
        pathParameters: '',
        queryParameters: '',
      }))
      .with('split', () => ({
        responseBody: method.responseBody ? responseBodyName : '',
        requestBody: method.requestBody ? requestBodyBaseName : '',
        pathParameters: method.pathParameters ? `${requestBodyBaseName}${PATH_PARAMETERS_SUFFIX}` : '',
        queryParameters: method.queryParameters ? `${requestBodyBaseName}${QUERY_PARAMETERS_SUFFIX}` : '',
      }))
      .exhaustive();
  }

  private buildRequestTypes(method: Method): ts.Node[] {
    const nodes: ts.Node[] = [];
    const names = this.getMethodNames(method);

    switch (this.config.types.requestType) {
      case 'merged': {
        const mergedSchema: ObjectSchema = {
          type: 'object',
          properties: {},
          ...(method.requestBody as ObjectSchema | undefined),
        };

        if (method.pathParameters?.length) {
          mergedSchema.properties = {
            ...mergedSchema.properties,
            ...this.parametersToSchema(method.pathParameters).properties,
          };
        }

        if (method.queryParameters?.length) {
          mergedSchema.properties = {
            ...mergedSchema.properties,
            ...this.parametersToSchema(method.queryParameters).properties,
          };
        }

        const mergedType = this.generateSchema(names.requestBody, mergedSchema);

        if (mergedType) {
          nodes.push(mergedType);
        }

        break;
      }
      case 'split': {
        if (method.requestBody) {
          const requestBodyType = this.generateSchema(names.requestBody, method.requestBody);

          if (requestBodyType) {
            nodes.push(requestBodyType);
          }
        }

        if (method.pathParameters?.length) {
          const schema = this.parametersToSchema(method.pathParameters);

          const pathParametersType = this.generateSchema(names.pathParameters, schema);

          if (pathParametersType) {
            nodes.push(pathParametersType);
          }
        }

        if (method.queryParameters?.length) {
          const schema = this.parametersToSchema(method.queryParameters);

          const queryParametersType = this.generateSchema(names.queryParameters, schema);

          if (queryParametersType) {
            nodes.push(queryParametersType);
          }
        }

        break;
      }
    }

    return nodes;
  }

  private generateTypesFile(jdef: API) {
    const nodeList: ts.Node[] = [
      factory.createJSDocComment('DO NOT EDIT! Types generated from jdef.json'),
      factory.createIdentifier('\n'),
    ];

    // Generate interfaces from schemas
    for (const [schemaName, schema] of Object.entries(jdef.schemas)) {
      const type = this.generateSchema(schemaName, schema);

      if (type) {
        nodeList.push(type, factory.createIdentifier('\n'));
      }
    }

    // Generate request and response types for each method
    for (const pkg of jdef.packages) {
      for (const method of pkg.methods) {
        const names = this.getMethodNames(method);

        // Add the response type
        if (method.responseBody) {
          const responseNode = this.generateSchema(names.responseBody, method.responseBody);

          if (responseNode) {
            nodeList.push(responseNode, factory.createIdentifier('\n'));
          }
        }

        // Add the request type(s) (depending on merged or split configuration)
        const requestNodes = this.buildRequestTypes(method);

        for (const node of requestNodes) {
          nodeList.push(node, factory.createIdentifier('\n'));
        }
      }
    }

    const printer = createPrinter({ newLine: NewLineKind.LineFeed });

    return printer.printList(
      ListFormat.MultiLine,
      factory.createNodeArray(nodeList),
      createSourceFile(this.config.typeOutput.fileName, '', ScriptTarget.ESNext, true, ScriptKind.TS),
    );
  }

  private generateClient(jdef: API) {
    if (!this.config.clientOutput) {
      return;
    }

    const typeImportPath = match(this.config.typeOutput.importPath)
      .with(P.string, (p) => p)
      .otherwise(() => {
        let typesPath = path
          .join(this.config.typeOutput.directory, this.config.typeOutput.fileName)
          .replaceAll(path.sep, '/');
        let clientPath = path
          .join(this.config.clientOutput?.directory || './', this.config.clientOutput?.fileName || 'index.ts')
          .replaceAll(path.sep, '/');

        if (this.config.typeOutput.directory.startsWith('./') && !typesPath.startsWith('.')) {
          typesPath = `./${typesPath}`;
        }

        if (this.config.clientOutput?.directory.startsWith('./') && !clientPath.startsWith('.')) {
          clientPath = `./${clientPath}`;
        }

        const relativePath = getRelativePath(clientPath, typesPath).replaceAll('index', '').replace(/\.ts$/, '');

        if (relativePath.endsWith('/')) {
          return relativePath.slice(0, -1);
        }

        return relativePath;
      });

    const requestInitFn = match(this.config.types.requestType)
      .with('split', () => buildSplitRequestInit.name)
      .with('merged', () => buildMergedRequestInit.name)
      .exhaustive();

    const makeRequestFn = makeRequest.name;

    const imports = new Set<string>();

    for (const pkg of jdef.packages) {
      for (const method of pkg.methods) {
        const names = this.getMethodNames(method);

        for (const name of Object.values(names)) {
          if (name) {
            imports.add(name);
          }
        }
      }
    }

    const nodeList: ts.Node[] = [
      factory.createJSDocComment('DO NOT EDIT! Client generated from jdef.json'),
      factory.createIdentifier('\n'),
      factory.createImportDeclaration(
        undefined,
        factory.createImportClause(
          false,
          factory.createIdentifier(`{ ${requestInitFn}, ${makeRequestFn} }`),
          undefined,
        ),
        factory.createStringLiteral(REQUEST_LIBRARY_NAME, true),
      ),
    ];

    if (imports.size) {
      nodeList.push(
        factory.createImportDeclaration(
          undefined,
          factory.createImportClause(
            true,
            factory.createIdentifier(`{ ${Array.from(imports).join(', ')} }`),
            undefined,
          ),
          factory.createStringLiteral(typeImportPath, true),
        ),
      );
    }

    // Add a newline after the imports
    nodeList.push(factory.createIdentifier('\n'));

    for (const pkg of jdef.packages) {
      for (const method of pkg.methods) {
        const names = this.getMethodNames(method);

        const makeRequestFnTypeNames = [names.responseBody, names.requestBody];

        for (let i = makeRequestFnTypeNames.length - 1; i >= 0; i--) {
          if (!makeRequestFnTypeNames[i]) {
            makeRequestFnTypeNames.splice(i, 1);
          } else {
            break;
          }
        }

        const makeRequestFnArguments = [
          factory.createParameterDeclaration(
            undefined,
            undefined,
            factory.createIdentifier('baseUrl'),
            undefined,
            factory.createUnionTypeNode([
              factory.createKeywordTypeNode(SyntaxKind.StringKeyword),
              factory.createKeywordTypeNode(SyntaxKind.UndefinedKeyword),
            ]),
          ),
        ];

        const requestInitFnArguments: Expression[] = [
          factory.createStringLiteral(method.httpMethod.toUpperCase(), true),
          factory.createLogicalOr(factory.createIdentifier('baseUrl'), factory.createStringLiteral('', true)),
          factory.createStringLiteral(method.httpPath, true),
        ];

        switch (this.config.types.requestType) {
          case 'merged': {
            const requestParamName = 'request';

            if (names.requestBody) {
              makeRequestFnArguments.push(
                factory.createParameterDeclaration(
                  undefined,
                  undefined,
                  factory.createIdentifier(requestParamName),
                  optionalFieldMarker,
                  factory.createTypeReferenceNode(names.requestBody),
                ),
              );
            }

            requestInitFnArguments.push(
              names.requestBody ? factory.createIdentifier(requestParamName) : factory.createIdentifier('undefined'),
            );

            break;
          }
          case 'split': {
            const pathParametersParamName = 'pathParameters';
            const queryParametersParamName = 'queryParameters';
            const requestBodyParamName = 'requestBody';

            if (names.pathParameters) {
              makeRequestFnArguments.push(
                factory.createParameterDeclaration(
                  undefined,
                  undefined,
                  factory.createIdentifier(pathParametersParamName),
                  optionalFieldMarker,
                  factory.createTypeReferenceNode(names.pathParameters),
                ),
              );
            }

            requestInitFnArguments.push(
              names.pathParameters
                ? factory.createIdentifier(pathParametersParamName)
                : factory.createIdentifier('undefined'),
            );

            if (names.queryParameters) {
              makeRequestFnArguments.push(
                factory.createParameterDeclaration(
                  undefined,
                  undefined,
                  factory.createIdentifier(queryParametersParamName),
                  optionalFieldMarker,
                  factory.createTypeReferenceNode(names.queryParameters),
                ),
              );
            }

            requestInitFnArguments.push(
              names.queryParameters
                ? factory.createIdentifier(queryParametersParamName)
                : factory.createIdentifier('undefined'),
            );

            if (names.requestBody) {
              makeRequestFnArguments.push(
                factory.createParameterDeclaration(
                  undefined,
                  undefined,
                  factory.createIdentifier(requestBodyParamName),
                  optionalFieldMarker,
                  factory.createTypeReferenceNode(names.requestBody),
                ),
              );
            }

            requestInitFnArguments.push(
              names.requestBody
                ? factory.createIdentifier(requestBodyParamName)
                : factory.createIdentifier('undefined'),
            );

            break;
          }
        }

        makeRequestFnArguments.push(
          factory.createParameterDeclaration(
            undefined,
            undefined,
            factory.createIdentifier(REQUEST_INIT_PARAMETER_NAME),
            optionalFieldMarker,
            factory.createTypeReferenceNode('RequestInit'),
          ),
        );

        requestInitFnArguments.push(factory.createIdentifier(REQUEST_INIT_PARAMETER_NAME));

        nodeList.push(
          factory.createFunctionDeclaration(
            [factory.createModifier(SyntaxKind.ExportKeyword), factory.createModifier(SyntaxKind.AsyncKeyword)],
            undefined,
            factory.createIdentifier(this.config.client.methodNameWriter(method)),
            undefined,
            makeRequestFnArguments,
            factory.createTypeReferenceNode(
              names.responseBody ? `Promise<${names.responseBody} | undefined>` : 'Promise<undefined>',
            ),
            factory.createBlock([
              factory.createReturnStatement(
                factory.createCallExpression(
                  factory.createIdentifier(makeRequestFn),
                  makeRequestFnTypeNames.map((name) =>
                    name
                      ? factory.createTypeReferenceNode(name)
                      : factory.createKeywordTypeNode(SyntaxKind.UndefinedKeyword),
                  ),
                  [
                    factory.createSpreadElement(
                      factory.createCallExpression(
                        factory.createIdentifier(requestInitFn),
                        undefined,
                        requestInitFnArguments,
                      ),
                    ),
                  ],
                ),
              ),
            ]),
          ),
          factory.createIdentifier('\n'),
        );
      }
    }

    const printer = createPrinter({ newLine: NewLineKind.LineFeed });

    return printer.printList(
      ListFormat.MultiLine,
      factory.createNodeArray(nodeList),
      createSourceFile(this.config.clientOutput.fileName || 'client.ts', '', ScriptTarget.ESNext, true, ScriptKind.TS),
    );
  }

  public generate(jdef: API) {
    const typesFile = this.generateTypesFile(jdef);
    const clientFile = this.generateClient(jdef);

    return {
      typesFile,
      clientFile,
    };
  }
}

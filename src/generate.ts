import ts, { type Expression, Identifier, type TypeElement, type TypeLiteralNode, type TypeNode } from 'typescript';
import { match, P } from 'ts-pattern';
import { pascalCase } from 'change-case';
import { Config } from './config';
import { buildMergedRequestInit, buildSplitRequestInit, makeRequest } from '@pentops/jsonapi-request';
import { getImportPath } from './helpers';
import {
  ParsedEnum,
  ParsedMap,
  ParsedMethod,
  ParsedObject,
  ParsedOneOf,
  ParsedSchema,
  ParsedSchemaWithRef,
  ParsedSource,
} from './parsed-types';

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

export interface GeneratedSchema {
  generatedName: string;
  rawSchema: ParsedSchema;
}

export interface GeneratedClientFunction {
  generatedName: string;
  rawMethod: ParsedMethod;
  requestBodyType?: GeneratedSchema;
  responseBodyType?: GeneratedSchema;
  pathParametersType?: GeneratedSchema;
  queryParametersType?: GeneratedSchema;
}

export class Generator {
  public config: Config;
  private oneOfsToGenerateTypesFor: Set<string> = new Set();
  public generatedSchemas: Map<string, GeneratedSchema> = new Map();
  public generatedClientFunctions: GeneratedClientFunction[] = [];

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

  private getValidTypeName(schema: ParsedSchema, ...backupValues: string[]) {
    let value = (schema as ParsedObject)?.object?.fullGrpcName || (schema as ParsedObject)?.object?.name || '';

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

  private buildUnionEnum(schema: ParsedEnum) {
    return factory.createUnionTypeNode(
      schema.enum.options.map((value) => factory.createLiteralTypeNode(factory.createStringLiteral(value.name, true))),
    );
  }

  private buildBaseType(schema: ParsedSchemaWithRef): { node: TypeNode; comment?: string } {
    return (
      match(schema)
        .with({ boolean: P.not(P.nullish) }, () => ({ node: factory.createTypeReferenceNode('boolean') }))
        // all nested enums are union types
        .with({ enum: P.not(P.nullish) }, (s) => ({ node: this.buildUnionEnum(s) }))
        .with({ string: P.not(P.nullish) }, (s) => ({
          node: factory.createKeywordTypeNode(SyntaxKind.StringKeyword),
          comment:
            [
              s.string.format ? `format: ${s.string.format}` : undefined,
              s.string.rules?.pattern ? `pattern: ${s.string.rules.pattern}` : undefined,
            ]
              .filter(Boolean)
              .join(', ') || undefined,
        }))
        .with({ integer: P.not(P.nullish) }, (s) => ({
          node: s.integer.format?.endsWith('64')
            ? factory.createKeywordTypeNode(SyntaxKind.StringKeyword)
            : factory.createTypeReferenceNode('number'),
          comment: s.integer.format ? `format: ${s.integer.format}` : undefined,
        }))
        .with({ float: P.not(P.nullish) }, (s) => ({
          node: s.float.format?.endsWith('64')
            ? factory.createKeywordTypeNode(SyntaxKind.StringKeyword)
            : factory.createTypeReferenceNode('number'),
          comment: s.float.format ? `format: ${s.float.format}` : undefined,
        }))
        .with({ $ref: P.not(P.nullish) }, (s) => ({
          node: factory.createTypeReferenceNode(this.getValidTypeName({ object: { name: s.$ref } } as ParsedSchema)),
        }))
        .with({ object: P.not(P.nullish) }, (s) => ({ node: this.buildObject(s) }))
        .with({ map: P.not(P.nullish) }, (s) => ({ node: this.buildMapType(s) }))
        .with({ oneOf: P.not(P.nullish) }, (s) => ({ node: this.buildOneOf(s) }))
        .with({ array: P.not(P.nullish) }, (s) => {
          const { node, comment } = this.buildBaseType(s.array.itemSchema);

          return { node: factory.createArrayTypeNode(node), comment };
        })
        .with({ any: P.not(P.nullish) }, () => ({ node: factory.createTypeReferenceNode('any') }))
        .otherwise(() => ({ node: factory.createTypeReferenceNode('any') }))
    );
  }

  private buildMapType(schema: ParsedMap) {
    return factory.createTypeReferenceNode('Record', [
      this.buildBaseType(schema.map.keySchema).node,
      this.buildBaseType(schema.map.itemSchema).node,
    ]);
  }

  private buildOneOf(schema: ParsedOneOf) {
    const members: (TypeElement | Identifier)[] = [];
    const entries = Object.entries(schema.oneOf.properties || {});

    entries.forEach(([name, property], i) => {
      const { node, comment } = this.buildBaseType(property.schema);

      let member = factory.createPropertySignature(
        undefined,
        this.getValidKeyName(name),
        property.required ? undefined : optionalFieldMarker,
        node,
      );

      if (comment) {
        member = addSyntheticLeadingComment(member, SyntaxKind.SingleLineCommentTrivia, ` ${comment}`, true);
      }

      // Add a comment before the first member for oneOfs
      if (i === 0) {
        member = addSyntheticLeadingComment(member, SyntaxKind.SingleLineCommentTrivia, ' start oneOf', false);
      }

      members.push(member);

      if (i === entries.length - 1) {
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

  private buildObject(schema: ParsedObject) {
    const members: (TypeElement | Identifier)[] = [];
    const entries = Object.entries(schema.object.properties || {});

    entries.forEach(([name, property]) => {
      const { node, comment } = this.buildBaseType(property.schema);

      let member = factory.createPropertySignature(
        undefined,
        this.getValidKeyName(name),
        property.required ? undefined : optionalFieldMarker,
        node,
      );

      if (comment) {
        member = addSyntheticLeadingComment(member, SyntaxKind.SingleLineCommentTrivia, ` ${comment}`, true);
      }

      members.push(member);
    });

    return factory.createTypeLiteralNode(members as readonly TypeElement[]);
  }

  private generateSchema(generatedName: string, schema: ParsedSchemaWithRef) {
    if (!generatedName) {
      return;
    }

    return match(schema)
      .with({ object: P.not(P.nullish) }, (s) =>
        factory.createInterfaceDeclaration(
          [factory.createModifier(SyntaxKind.ExportKeyword)],
          factory.createIdentifier(generatedName),
          [],
          [],
          (this.buildObject(s) as TypeLiteralNode)?.members,
        ),
      )
      .with({ map: P.not(P.nullish) }, (s) => this.buildMapType(s))
      .with({ oneOf: P.not(P.nullish) }, (s) => {
        this.oneOfsToGenerateTypesFor.add(generatedName);

        return factory.createInterfaceDeclaration(
          [factory.createModifier(SyntaxKind.ExportKeyword)],
          factory.createIdentifier(generatedName),
          [],
          [],
          this.buildOneOf(s)?.members,
        );
      })
      .with({ enum: P.not(P.nullish) }, (s) =>
        match(this.config.types.enumType)
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
              s.enum.options.map((value) =>
                factory.createEnumMember(
                  factory.createIdentifier(this.getValidKeyName(pascalCase(value.name))),
                  factory.createStringLiteral(value.name, true),
                ),
              ),
            ),
          )
          .exhaustive(),
      )
      .otherwise(() => this.buildBaseType(schema).node);
  }

  private getMethodNames(method: ParsedMethod) {
    const responseBodyName = this.getValidTypeName(
      method.responseBody as ParsedSchema,
      `${method.fullGrpcName.replaceAll('/', '')}${RESPONSE_SUFFIX}`,
      `${method.name}${RESPONSE_SUFFIX}`,
    );

    const requestBaseFirstPriorityBackup = responseBodyName?.endsWith(RESPONSE_SUFFIX)
      ? responseBodyName?.replace(RESPONSE_SUFFIX, REQUEST_SUFFIX)
      : `${method.fullGrpcName.replaceAll('/', '')}${REQUEST_SUFFIX}`;
    const requestBodyBaseName = this.getValidTypeName(
      method.requestBody as ParsedSchema,
      requestBaseFirstPriorityBackup,
      `${method.name}${REQUEST_SUFFIX}`,
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
        pathParameters: method.pathParameters?.length ? `${requestBodyBaseName}${PATH_PARAMETERS_SUFFIX}` : '',
        queryParameters: method.queryParameters?.length ? `${requestBodyBaseName}${QUERY_PARAMETERS_SUFFIX}` : '',
      }))
      .exhaustive();
  }

  private buildRequestTypes(method: ParsedMethod): ts.Node[] {
    const nodes: ts.Node[] = [];
    const names = this.getMethodNames(method);

    switch (this.config.types.requestType) {
      case 'merged': {
        const mergedSchema: ParsedObject = {
          object: {
            fullGrpcName: '',
            name: '',
            properties: {},
            rules: {},
            ...(method.requestBody as ParsedObject | undefined)?.object,
          },
        };

        if (method.pathParameters?.length) {
          mergedSchema.object.properties = {
            ...mergedSchema.object.properties,
            ...method.pathParameters.reduce(
              (acc, curr) => ({
                ...acc,
                [curr.name]: curr,
              }),
              {},
            ),
          };
        }

        if (method.queryParameters?.length) {
          mergedSchema.object.properties = {
            ...mergedSchema.object.properties,
            ...method.queryParameters.reduce(
              (acc, curr) => ({
                ...acc,
                [curr.name]: curr,
              }),
              {},
            ),
          };
        }

        const mergedType = this.generateSchema(names.requestBody, mergedSchema);

        if (mergedType) {
          this.generatedSchemas.set(names.requestBody, { generatedName: names.requestBody, rawSchema: mergedSchema });

          nodes.push(mergedType);
        }

        break;
      }
      case 'split': {
        if (method.requestBody) {
          const requestBodyType = this.generateSchema(names.requestBody, method.requestBody);

          if (requestBodyType) {
            this.generatedSchemas.set(names.requestBody, {
              generatedName: names.requestBody,
              rawSchema: method.requestBody as ParsedObject,
            });

            nodes.push(requestBodyType);
          }
        }

        if (method.pathParameters?.length) {
          const schema: ParsedObject = {
            object: {
              fullGrpcName: '',
              name: names.pathParameters,
              rules: {},
              properties: method.pathParameters.reduce(
                (acc, curr) => ({
                  ...acc,
                  [curr.name]: curr,
                }),
                {},
              ),
            },
          };

          const pathParametersType = this.generateSchema(names.pathParameters, schema);

          if (pathParametersType) {
            this.generatedSchemas.set(names.pathParameters, {
              generatedName: names.pathParameters,
              rawSchema: schema,
            });

            nodes.push(pathParametersType);
          }
        }

        if (method.queryParameters?.length) {
          const schema: ParsedObject = {
            object: {
              fullGrpcName: '',
              name: names.queryParameters,
              rules: {},
              properties: method.queryParameters.reduce(
                (acc, curr) => ({
                  ...acc,
                  [curr.name]: curr,
                }),
                {},
              ),
            },
          };

          const queryParametersType = this.generateSchema(
            this.getValidTypeName(schema as ParsedSchema, names.queryParameters),
            schema,
          );

          if (queryParametersType) {
            this.generatedSchemas.set(names.queryParameters, {
              generatedName: names.queryParameters,
              rawSchema: schema,
            });

            nodes.push(queryParametersType);
          }
        }

        break;
      }
    }

    return nodes;
  }

  private generateTypesFile(source: ParsedSource) {
    const nodeList: ts.Node[] = this.config.typeOutput.topOfFileComment
      ? [factory.createJSDocComment(this.config.typeOutput.topOfFileComment), factory.createIdentifier('\n')]
      : [];

    // Generate interfaces from schemas
    for (const [schemaName, schema] of Object.entries(source.schemas)) {
      const typeName = this.getValidTypeName(schema, schemaName);
      const type = this.generateSchema(typeName, schema);

      if (type) {
        this.generatedSchemas.set(schemaName, { generatedName: typeName, rawSchema: schema });
        nodeList.push(type, factory.createIdentifier('\n'));
      }
    }

    // Create oneOf union types from oneOf type schemas
    this.oneOfsToGenerateTypesFor.forEach((oneOfSchema) => {
      const oneOfType = factory.createTypeAliasDeclaration(
        [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
        `${oneOfSchema}OneOfValue`,
        undefined,
        ts.factory.createTypeOperatorNode(
          ts.SyntaxKind.KeyOfKeyword,
          ts.factory.createTypeReferenceNode(ts.factory.createIdentifier('Exclude'), [
            ts.factory.createTypeReferenceNode(ts.factory.createIdentifier(oneOfSchema)),
            factory.createKeywordTypeNode(SyntaxKind.UndefinedKeyword),
          ]),
        ),
      );

      nodeList.push(oneOfType, factory.createIdentifier('\n'));
    });

    // Generate request and response types for each method
    for (const pkg of source.packages) {
      for (const service of pkg.services) {
        for (const method of service.methods) {
          const names = this.getMethodNames(method);

          // Add the response type
          if (method.responseBody) {
            const typeName = this.getValidTypeName(method.responseBody as ParsedSchema, names.responseBody);
            const responseNode = this.generateSchema(typeName, method.responseBody);

            if (responseNode) {
              this.generatedSchemas.set(names.responseBody, {
                generatedName: typeName,
                rawSchema: method.responseBody as ParsedSchema,
              });

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
    }

    const printer = createPrinter({ newLine: NewLineKind.LineFeed });

    return printer.printList(
      ListFormat.MultiLine,
      factory.createNodeArray(nodeList),
      createSourceFile(this.config.typeOutput.fileName, '', ScriptTarget.ESNext, true, ScriptKind.TS),
    );
  }

  private generateClient(source: ParsedSource) {
    if (!this.config.clientOutput) {
      return;
    }

    const typeImportPath = match(this.config.typeOutput.importPath)
      .with(P.string, (p) => p)
      .otherwise(() =>
        getImportPath(
          this.config.typeOutput.directory,
          this.config.typeOutput.fileName,
          this.config.clientOutput?.directory || './',
          this.config.clientOutput?.fileName || 'index.ts',
        ),
      );

    const requestInitFn = match(this.config.types.requestType)
      .with('split', () => buildSplitRequestInit.name)
      .with('merged', () => buildMergedRequestInit.name)
      .exhaustive();

    const makeRequestFn = makeRequest.name;

    const imports = new Set<string>();

    for (const pkg of source.packages) {
      for (const service of pkg.services) {
        for (const method of service.methods) {
          const names = this.getMethodNames(method);

          for (const name of Object.values(names)) {
            if (name) {
              imports.add(name);
            }
          }
        }
      }
    }

    const nodeList: ts.Node[] = [
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

    if (this.config.clientOutput.topOfFileComment) {
      nodeList.unshift(
        factory.createJSDocComment(this.config.clientOutput.topOfFileComment),
        factory.createIdentifier('\n'),
      );
    }

    if (imports.size) {
      nodeList.push(
        factory.createImportDeclaration(
          undefined,
          factory.createImportClause(
            true,
            undefined,
            factory.createNamedImports(
              Array.from(imports).map((name) =>
                factory.createImportSpecifier(false, undefined, factory.createIdentifier(name)),
              ),
            ),
          ),
          factory.createStringLiteral(typeImportPath, true),
        ),
      );
    }

    // Add a newline after the imports
    nodeList.push(factory.createIdentifier('\n'));

    for (const pkg of source.packages) {
      for (const service of pkg.services) {
        for (const method of service.methods) {
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

          const methodName = this.config.client.methodNameWriter(method);

          nodeList.push(
            factory.createFunctionDeclaration(
              [factory.createModifier(SyntaxKind.ExportKeyword), factory.createModifier(SyntaxKind.AsyncKeyword)],
              undefined,
              factory.createIdentifier(methodName),
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

          this.generatedClientFunctions.push({
            generatedName: methodName,
            rawMethod: method,
            requestBodyType: names.requestBody ? this.generatedSchemas.get(names.requestBody) : undefined,
            responseBodyType: names.responseBody ? this.generatedSchemas.get(names.responseBody) : undefined,
            pathParametersType: names.pathParameters ? this.generatedSchemas.get(names.pathParameters) : undefined,
            queryParametersType: names.queryParameters ? this.generatedSchemas.get(names.queryParameters) : undefined,
          });
        }
      }
    }

    const printer = createPrinter({ newLine: NewLineKind.LineFeed });

    return printer.printList(
      ListFormat.MultiLine,
      factory.createNodeArray(nodeList),
      createSourceFile(this.config.clientOutput.fileName || 'client.ts', '', ScriptTarget.ESNext, true, ScriptKind.TS),
    );
  }

  public generate(source: ParsedSource) {
    const typesFile = this.generateTypesFile(source);
    const clientFile = this.generateClient(source);

    return {
      typesFile,
      clientFile,
    };
  }
}

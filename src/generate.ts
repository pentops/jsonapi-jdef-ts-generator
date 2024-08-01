import ts, { type Expression, Identifier, type TypeElement, type TypeNode } from 'typescript';
import { match, P } from 'ts-pattern';
import { pascalCase } from 'change-case';
import type { Config, GenericOverride, GenericOverrideMap, GenericOverrideWithValue } from './config';
import { buildMergedRequestInit, buildSplitRequestInit, makeRequest } from '@pentops/jsonapi-request';
import {
  buildGenericReferenceNode,
  cleanRefName,
  createImportDeclaration,
  getAllGenericsForChildren,
  getFullGRPCName,
  getImportPath,
  getObjectProperties,
  getSchemaName,
  getValidKeyName,
  isCharacterSafeForName,
  isKeyword,
} from './helpers';
import type {
  ParsedEnum,
  ParsedMethod,
  ParsedObject,
  ParsedObjectProperty,
  ParsedOneOf,
  ParsedRef,
  ParsedSchema,
  ParsedSchemaWithRef,
  ParsedSource,
} from './parsed-types';
import {
  BuiltMethodSchema,
  GeneratedClientFunction,
  GeneratedSchema,
  GeneratedSchemaWithNode,
} from './generated-types';

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

interface BaseTypeOutput {
  node: TypeNode;
  comment?: string;
}

const REQUEST_LIBRARY_NAME = '@pentops/jsonapi-request';
const REQUEST_SUFFIX = 'Request';
const RESPONSE_SUFFIX = 'Response';
const PATH_PARAMETERS_SUFFIX = 'PathParameters';
const QUERY_PARAMETERS_SUFFIX = 'QueryParameters';
const REQUEST_INIT_PARAMETER_NAME = 'requestInit';

const optionalFieldMarker = factory.createToken(SyntaxKind.QuestionToken);

export class Generator {
  public config: Config;
  public builtMethodSchemas: Map<string, BuiltMethodSchema> = new Map();
  public generatedSchemas: Map<string, GeneratedSchema> = new Map();
  public generatedClientFunctions: GeneratedClientFunction[] = [];
  public schemaGenerics: Map<string, GenericOverrideMap>;

  constructor(config: Config) {
    this.config = config;
    this.schemaGenerics = config.types.genericOverrides || new Map();
  }

  private static buildGenericNodeFromDefinition(definition: GenericOverride) {
    return factory.createTypeParameterDeclaration(
      undefined,
      definition.name,
      definition.extends
        ? typeof definition.extends === 'object'
          ? definition.extends
          : buildGenericReferenceNode(definition.extends)
        : undefined,
      definition.default
        ? typeof definition.default === 'object'
          ? definition.default
          : buildGenericReferenceNode(definition.default)
        : undefined,
    );
  }

  private static buildUnionEnum(schema: ParsedEnum) {
    return factory.createUnionTypeNode(
      schema.enum.options.map((value) => factory.createLiteralTypeNode(factory.createStringLiteral(value.name, true))),
    );
  }

  private static generateEnum(name: string, schema: ParsedEnum, enumType: 'enum' | 'union') {
    switch (enumType) {
      case 'enum':
        return factory.createEnumDeclaration(
          [factory.createModifier(SyntaxKind.ExportKeyword)],
          factory.createIdentifier(name),
          schema.enum.options.map((value) =>
            factory.createEnumMember(
              factory.createIdentifier(getValidKeyName(pascalCase(value.name))),
              factory.createStringLiteral(value.name, true),
            ),
          ),
        );
      case 'union': {
        return factory.createTypeAliasDeclaration(
          [factory.createModifier(SyntaxKind.ExportKeyword)],
          factory.createIdentifier(name),
          [],
          Generator.buildUnionEnum(schema),
        );
      }
    }
  }

  private static generateOneOfUnionType(generatedName: string, oneOfGeneratedName: string) {
    return factory.createTypeAliasDeclaration(
      [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      generatedName,
      undefined,
      ts.factory.createTypeOperatorNode(
        ts.SyntaxKind.KeyOfKeyword,
        ts.factory.createTypeReferenceNode(ts.factory.createIdentifier('Exclude'), [
          ts.factory.createTypeReferenceNode(ts.factory.createIdentifier(oneOfGeneratedName)),
          factory.createKeywordTypeNode(SyntaxKind.UndefinedKeyword),
        ]),
      ),
    );
  }

  private static buildSchemaTypeParameterDeclarations(
    generics: GenericOverrideWithValue[] | undefined,
  ): ts.TypeParameterDeclaration[] | undefined {
    if (!generics?.length) {
      return undefined;
    }

    const declarations: ts.TypeParameterDeclaration[] = [];

    for (let i = generics.length - 1; i >= 0; i -= 1) {
      if (generics[i].value === undefined) {
        declarations.unshift(Generator.buildGenericNodeFromDefinition(generics[i]));
      }
    }

    return declarations;
  }

  private getValidTypeName(schema: ParsedSchemaWithRef, ...backupValues: string[]) {
    let value = match(schema)
      .with({ object: P.not(P.nullish) }, (s) => s.object.fullGrpcName || s.object.name || '')
      .with({ enum: P.not(P.nullish) }, (s) => s.enum.fullGrpcName || s.enum.name || '')
      .with({ oneOf: P.not(P.nullish) }, (s) => s.oneOf.fullGrpcName || s.oneOf.name || '')
      .with({ $ref: P.not(P.nullish) }, (s) => cleanRefName(s))
      .otherwise(() => '');

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

  private buildRefNode(schema: ParsedRef, genericValues?: GenericOverrideWithValue[]): BaseTypeOutput {
    const schemaGenerics = this.schemaGenerics.get(getFullGRPCName(schema));
    const refGenerics = getAllGenericsForChildren(schemaGenerics);
    const typeArguments: ts.TypeNode[] = [];

    let allTypesArgumentsAreDefault = true;

    const lastValueIndex = refGenerics.findLastIndex((generic) =>
      genericValues?.find((g) => g.name === generic.name && g.value),
    );

    const iterateToIndex = lastValueIndex === -1 ? refGenerics.length - 1 : lastValueIndex;

    for (let i = 0; i <= iterateToIndex; i += 1) {
      const generic = refGenerics[i];
      const matchingValue = genericValues?.find((g) => g.name === generic.name);

      if (matchingValue?.value) {
        typeArguments.push(matchingValue.value);

        if (matchingValue?.value !== generic.default) {
          allTypesArgumentsAreDefault = false;
        }
      } else if (matchingValue?.value === null) {
        const nodeType = generic.default || generic.extends || 'any';
        typeArguments.push(buildGenericReferenceNode(nodeType));

        if (nodeType !== generic.default) {
          allTypesArgumentsAreDefault = false;
        }
      } else {
        typeArguments.push(factory.createTypeReferenceNode(generic.name));
        allTypesArgumentsAreDefault = false;
      }
    }

    return {
      node: factory.createTypeReferenceNode(
        this.getValidTypeName(schema),
        allTypesArgumentsAreDefault ? undefined : typeArguments,
      ),
    };
  }

  private buildBaseType(schema: ParsedSchemaWithRef, genericValues?: GenericOverrideWithValue[]): BaseTypeOutput {
    const fullGrpcName = getFullGRPCName(schema);

    return (
      match(schema)
        .with({ boolean: P.not(P.nullish) }, () => ({ node: factory.createKeywordTypeNode(SyntaxKind.BooleanKeyword) }))
        // all nested enums are union types
        .with({ enum: P.not(P.nullish) }, (s) => ({ node: Generator.buildUnionEnum(s) }))
        .with({ key: P.not(P.nullish) }, (s) => ({
          node: factory.createKeywordTypeNode(SyntaxKind.StringKeyword),
          comment: s.key.format ? `format: ${s.key.format}` : undefined,
        }))
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
            : factory.createKeywordTypeNode(SyntaxKind.NumberKeyword),
          comment: s.integer.format ? `format: ${s.integer.format}` : undefined,
        }))
        .with({ float: P.not(P.nullish) }, (s) => ({
          node: s.float.format?.endsWith('64')
            ? factory.createKeywordTypeNode(SyntaxKind.StringKeyword)
            : factory.createKeywordTypeNode(SyntaxKind.NumberKeyword),
          comment: s.float.format ? `format: ${s.float.format}` : undefined,
        }))
        .with({ $ref: P.not(P.nullish) }, (s) => this.buildRefNode(s, genericValues))
        .with({ object: P.not(P.nullish) }, (s) => {
          const schemaGenerics = this.schemaGenerics.get(fullGrpcName);

          return { node: this.buildObject(s, schemaGenerics, genericValues) };
        })
        // TODO: generic handling in maps
        .with({ map: P.not(P.nullish) }, (s) => ({
          node: this.buildMapType(s.map.keySchema, s.map.itemSchema, genericValues),
        }))
        .with({ oneOf: P.not(P.nullish) }, (s) => {
          const schemaGenerics = this.schemaGenerics.get(fullGrpcName);

          return { node: this.buildOneOf(s, schemaGenerics, genericValues) };
        })
        .with({ array: P.not(P.nullish) }, (s) => {
          const { node, comment } = this.buildBaseType(s.array.itemSchema, genericValues);

          return { node: factory.createArrayTypeNode(node), comment };
        })
        .with({ bytes: P.not(P.nullish) }, () => ({
          node: factory.createKeywordTypeNode(SyntaxKind.StringKeyword),
          comment: 'bytes',
        }))
        .with({ any: P.not(P.nullish) }, () => ({ node: factory.createKeywordTypeNode(SyntaxKind.AnyKeyword) }))
        .otherwise(() => {
          console.log('Unknown schema type', schema);
          return { node: factory.createKeywordTypeNode(SyntaxKind.AnyKeyword) };
        })
    );
  }

  private buildMapType(
    keySchema: ParsedSchemaWithRef,
    itemSchema: ParsedSchemaWithRef,
    genericValues?: GenericOverrideWithValue[],
  ) {
    return factory.createTypeReferenceNode('Record', [
      this.buildBaseType(keySchema, genericValues).node,
      this.buildBaseType(itemSchema, genericValues).node,
    ]);
  }

  private buildBaseObjectMember(
    name: string,
    property: ParsedObjectProperty,
    parentGenerics: GenericOverrideMap | undefined,
    genericValues: GenericOverrideWithValue[] | undefined,
  ) {
    const genericOverrideForProperty = parentGenerics?.get(name);
    const { node, comment } = this.buildBaseType(
      property.schema,
      match(property.schema)
        .with(
          P.union(
            { $ref: P.not(P.nullish) },
            { array: { itemSchema: { $ref: P.not(P.nullish) } } },
            { map: { itemSchema: { $ref: P.not(P.nullish) } } },
            { map: { keySchema: { $ref: P.not(P.nullish) } } },
          ),
          () => genericValues,
        )
        .otherwise(() => undefined),
    );

    const validKeyName = getValidKeyName(name);

    if (validKeyName !== name) {
      console.warn(
        `[jdef-ts-generator]: invalid JavaScript object key name for property ${name}, using ${validKeyName} instead. This may cause issues with generated code.`,
      );
    }

    let nodeTypeGenericOverride: TypeNode | undefined;
    // If the property has a generic override, and it's not a map, use the generic override as the type
    if (genericOverrideForProperty && !(genericOverrideForProperty instanceof Map)) {
      nodeTypeGenericOverride = factory.createTypeReferenceNode(genericOverrideForProperty.name);
    }

    let member = factory.createPropertySignature(
      undefined,
      validKeyName,
      property.required ? undefined : optionalFieldMarker,
      nodeTypeGenericOverride || node,
    );

    if (comment) {
      member = addSyntheticLeadingComment(member, SyntaxKind.SingleLineCommentTrivia, ` ${comment}`, true);
    }

    return member;
  }

  private buildOneOf(schema: ParsedOneOf, generics?: GenericOverrideMap, genericValues?: GenericOverrideWithValue[]) {
    const members: (TypeElement | Identifier)[] = [];

    let i = 0;
    for (const [name, property] of schema.oneOf.properties) {
      let member = this.buildBaseObjectMember(name, property, generics, genericValues);

      // Add a comment before the first member for oneOfs
      if (i === 0) {
        member = addSyntheticLeadingComment(member, SyntaxKind.SingleLineCommentTrivia, ' start oneOf', false);
      }

      members.push(member);

      if (i === schema.oneOf.properties.size - 1) {
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

      i += 1;
    }

    return factory.createTypeLiteralNode(members as readonly TypeElement[]);
  }

  private buildObject(schema: ParsedObject, generics?: GenericOverrideMap, genericValues?: GenericOverrideWithValue[]) {
    const members: (TypeElement | Identifier)[] = [];

    for (const [name, property] of schema.object.properties) {
      members.push(this.buildBaseObjectMember(name, property, generics, genericValues));
    }

    return factory.createTypeLiteralNode(members as readonly TypeElement[]);
  }

  private generateSchema(
    generatedName: string,
    schema: ParsedSchema,
    parentMethod?: BuiltMethodSchema,
  ): GeneratedSchemaWithNode[] | undefined {
    if (!generatedName) {
      return;
    }

    const fullGrpcName = getFullGRPCName(schema);

    const schemaGenerics = this.schemaGenerics.get(fullGrpcName);
    const allGenericsWithValues: GenericOverrideWithValue[] | undefined = this.config.types.genericValueDeterminer
      ? this.config.types.genericValueDeterminer(
          schema as ParsedObject | ParsedOneOf,
          (s) => this.schemaGenerics.get(getFullGRPCName(s)),
          parentMethod,
        )
      : getAllGenericsForChildren(schemaGenerics);

    return match(schema)
      .returnType<GeneratedSchemaWithNode[] | undefined>()
      .with({ object: P.not(P.nullish) }, (s) => {
        return [
          {
            generatedName,
            rawSchema: s,
            fullGrpcName,
            node: factory.createInterfaceDeclaration(
              [factory.createModifier(SyntaxKind.ExportKeyword)],
              factory.createIdentifier(generatedName),
              Generator.buildSchemaTypeParameterDeclarations(allGenericsWithValues),
              [],
              this.buildObject(s, schemaGenerics, allGenericsWithValues)?.members,
            ),
          },
        ];
      })
      .with({ oneOf: P.not(P.nullish) }, (s) => {
        const oneOfUnionGeneratedName = `${generatedName}OneOfValue`;

        return [
          {
            generatedName,
            rawSchema: s,
            fullGrpcName,
            node: factory.createInterfaceDeclaration(
              [factory.createModifier(SyntaxKind.ExportKeyword)],
              factory.createIdentifier(generatedName),
              Generator.buildSchemaTypeParameterDeclarations(allGenericsWithValues),
              [],
              this.buildOneOf(s, schemaGenerics, allGenericsWithValues)?.members,
            ),
          },
          {
            generatedName: oneOfUnionGeneratedName,
            node: Generator.generateOneOfUnionType(oneOfUnionGeneratedName, generatedName),
          },
        ];
      })
      .with({ enum: P.not(P.nullish) }, (s) => [
        {
          generatedName,
          fullGrpcName,
          rawSchema: s,
          node: Generator.generateEnum(generatedName, s, this.config.types.enumType),
        },
      ])
      .otherwise(() => {
        const builtNode = this.buildBaseType(schema).node;

        if (!builtNode) {
          return undefined;
        }

        return [
          {
            generatedName,
            fullGrpcName,
            rawSchema: schema,
            node: builtNode,
          },
        ];
      });
  }

  private prepareMethodTypes(method: ParsedMethod, schemas: Map<string, ParsedSchema>) {
    const methodGrpcNameBase = method.fullGrpcName.replaceAll('/', '');

    const responseBodyName =
      getSchemaName(method.responseBody as ParsedSchema, schemas) || `${method.name}${RESPONSE_SUFFIX}`;

    const requestBaseFirstPriorityBackup = responseBodyName?.endsWith(RESPONSE_SUFFIX)
      ? responseBodyName?.replace(RESPONSE_SUFFIX, REQUEST_SUFFIX)
      : '';
    const requestBaseName = this.getValidTypeName(
      method.requestBody as ParsedSchema,
      requestBaseFirstPriorityBackup,
      `${method.name}${REQUEST_SUFFIX}`,
    );

    const responseBody = match(method.responseBody)
      .returnType<ParsedObject | undefined>()
      .with({ object: P.not(P.nullish) }, (s) => {
        const defaultName = responseBodyName || s.object.name;

        return {
          ...s,
          object: {
            ...s.object,
            fullGrpcName: s.object.fullGrpcName || `${methodGrpcNameBase}${defaultName ? `.${defaultName}` : ''}`,
            name: defaultName,
          },
        };
      })
      .with({ $ref: P.not(P.nullish) }, (s) =>
        match(schemas.get(cleanRefName(s)))
          .with({ object: P.not(P.nullish) }, (so) => {
            const defaultName = responseBodyName || so.object.name;

            return {
              ...so,
              object: {
                ...so.object,
                fullGrpcName: so.object.fullGrpcName || `${methodGrpcNameBase}${defaultName ? `.${defaultName}` : ''}`,
                name: defaultName,
              },
            };
          })
          .otherwise(() => undefined),
      )
      .otherwise(() => undefined);

    const builtMethod =
      this.builtMethodSchemas.get(method.fullGrpcName) || ({ rawMethod: method } as BuiltMethodSchema);

    const relatedEntity = method.relatedEntity?.schemaFullGrpcName
      ? this.generatedSchemas.get(method.relatedEntity.schemaFullGrpcName)
      : undefined;

    if (relatedEntity) {
      builtMethod.relatedEntity = relatedEntity as GeneratedSchema<ParsedObject>;
    }

    if (responseBody) {
      builtMethod.responseBodySchema = { generatedName: this.getValidTypeName(responseBody), rawSchema: responseBody };
    }

    const requestBody = match(method.requestBody)
      .returnType<ParsedObject | undefined>()
      .with({ object: P.not(P.nullish) }, (s) => s)
      .with({ $ref: P.not(P.nullish) }, (s) =>
        match(schemas.get(cleanRefName(s)))
          .with({ object: P.not(P.nullish) }, (so) => so)
          .otherwise(() => undefined),
      )
      .otherwise(() => undefined);

    switch (this.config.types.requestType) {
      case 'split': {
        if (requestBody?.object?.properties?.size) {
          builtMethod.requestBodySchema = {
            generatedName: this.getValidTypeName(requestBody, requestBaseName),
            rawSchema: requestBody,
          };
        }

        if (method.pathParameters?.length) {
          const baseTypeName = `${requestBaseName}${PATH_PARAMETERS_SUFFIX}`;

          const pathParameterSchema: ParsedObject = {
            object: {
              fullGrpcName: `${methodGrpcNameBase}.${baseTypeName}`,
              name: baseTypeName,
              rules: {},
              properties: method.pathParameters.reduce((acc, curr) => {
                acc.set(curr.name, curr);
                return acc;
              }, new Map()),
            },
          };

          builtMethod.pathParametersSchema = {
            generatedName: this.getValidTypeName(pathParameterSchema, baseTypeName),
            rawSchema: pathParameterSchema,
          };
        }

        if (method.queryParameters?.length) {
          const baseTypeName = `${requestBaseName}${QUERY_PARAMETERS_SUFFIX}`;
          const queryParameterSchema: ParsedObject = {
            object: {
              fullGrpcName: `${methodGrpcNameBase}.${baseTypeName}`,
              name: baseTypeName,
              rules: {},
              properties: method.queryParameters.reduce((acc, curr) => {
                acc.set(curr.name, curr);
                return acc;
              }, new Map()),
            },
          };

          builtMethod.queryParametersSchema = {
            generatedName: getSchemaName(queryParameterSchema, schemas),
            rawSchema: queryParameterSchema,
          };
        }

        break;
      }
      case 'merged':
      default: {
        const defaultName = requestBaseName || REQUEST_SUFFIX;

        const mergedSchema: ParsedObject = {
          object: {
            name: method.requestBody || method.queryParameters || method.pathParameters ? defaultName : '',
            properties: new Map(requestBody?.object.properties),
            rules: {},
            ...requestBody,
            fullGrpcName: requestBody?.object?.fullGrpcName || `${methodGrpcNameBase}.${defaultName}` || '',
          },
        };

        if (method.pathParameters?.length) {
          method.pathParameters.forEach((param) => {
            mergedSchema.object.properties.set(param.name, param);
          });
        }

        if (method.queryParameters?.length) {
          method.queryParameters.forEach((param) => {
            mergedSchema.object.properties.set(param.name, param);
          });
        }

        if (mergedSchema.object.properties.size) {
          builtMethod.mergedRequestSchema = {
            generatedName: this.getValidTypeName(mergedSchema, requestBaseName),
            rawSchema: mergedSchema,
          };
        }

        break;
      }
    }

    if (method.listOptions) {
      builtMethod.list = new Map();

      const createGenericEnum = (name: string, values: string[]): GeneratedSchema<ParsedEnum> => {
        const mockGrpcName = `${method.fullGrpcName.replaceAll('/', '')}${name}Fields`;
        const schema: ParsedEnum = {
          enum: {
            fullGrpcName: mockGrpcName,
            name: this.config.types.nameWriter(mockGrpcName),
            prefix: '',
            options: values.map((value) => ({ name: value })),
          },
        };

        return { generatedName: schema.enum.name, rawSchema: schema };
      };

      if (method.listOptions.filterableFields?.length) {
        builtMethod.list.set(
          'filterableFields',
          createGenericEnum(
            'Filterable',
            method.listOptions.filterableFields.map((field) => field.name),
          ),
        );
      }

      if (method.listOptions.searchableFields?.length) {
        builtMethod.list.set('searchableFields', createGenericEnum('Searchable', method.listOptions.searchableFields));
      }

      if (method.listOptions.sortableFields?.length) {
        builtMethod.list.set(
          'sortableFields',
          createGenericEnum(
            'Sortable',
            method.listOptions.sortableFields.map((field) => field.name),
          ),
        );
      }
    }

    this.builtMethodSchemas.set(method.fullGrpcName, builtMethod);

    return builtMethod;
  }

  private buildType(
    schema: ParsedSchema,
    schemas: Map<string, ParsedSchema>,
    parentMethod?: BuiltMethodSchema,
  ): ts.Node[] | undefined {
    const nodes: ts.Node[] = [];

    if (schema) {
      const schemaName = getSchemaName(schema, schemas);
      const typeName = this.getValidTypeName(schema, schemaName);
      const typeNodes = this.generateSchema(typeName, schema, parentMethod);

      typeNodes?.forEach((node) => {
        this.generatedSchemas.set(node.fullGrpcName || node.generatedName || schemaName, {
          generatedName: node.generatedName || schemaName,
          rawSchema: node.rawSchema || schema,
        });

        nodes.push(node.node);
      });
    }

    return nodes;
  }

  private buildMethodTypes(builtMethod: BuiltMethodSchema, schemas: Map<string, ParsedSchema>): ts.Node[] {
    const nodes: ts.Node[] = [];

    if (!builtMethod) {
      return nodes;
    }

    // Add listify generic values
    if (builtMethod.list) {
      for (const [_, listSchema] of builtMethod.list) {
        const typeNodes = this.buildType(listSchema.rawSchema, schemas, builtMethod);

        if (typeNodes) {
          nodes.push(...typeNodes);
        }
      }
    }

    const methodSchemas = [
      builtMethod.responseBodySchema?.rawSchema,
      builtMethod.mergedRequestSchema?.rawSchema,
      builtMethod.requestBodySchema?.rawSchema,
      builtMethod.pathParametersSchema?.rawSchema,
      builtMethod.queryParametersSchema?.rawSchema,
    ].filter(Boolean) as ParsedSchema[];

    for (const methodSchema of methodSchemas) {
      const typeNodes = this.buildType(methodSchema, schemas, builtMethod);

      if (typeNodes) {
        nodes.push(...typeNodes);
      }
    }

    return nodes;
  }

  private prepareSchemaTypes(source: ParsedSource): ts.Node[] {
    const nodes: ts.Node[] = [];
    for (const [_, schema] of source.schemas) {
      this.populateGenerics(schema, source.schemas);

      const typeNodes = this.buildType(schema, source.schemas);

      if (typeNodes) {
        nodes.push(...typeNodes);
      }
    }

    return nodes;
  }

  private generateTypesFile(source: ParsedSource) {
    const schemaNodes = this.prepareSchemaTypes(source);
    this.prepareMethods(source);

    const nodeList: ts.Node[] = this.config.typeOutput.topOfFileComment
      ? [factory.createJSDocComment(this.config.typeOutput.topOfFileComment), factory.createIdentifier('\n')]
      : [];

    for (const schemaNode of schemaNodes) {
      nodeList.push(schemaNode, factory.createIdentifier('\n'));
    }

    // Generate request and response types for each method
    for (const [_, method] of this.builtMethodSchemas) {
      const methodNodes = this.buildMethodTypes(method, source.schemas);

      for (const node of methodNodes) {
        nodeList.push(node, factory.createIdentifier('\n'));
      }
    }

    const printer = createPrinter({ newLine: NewLineKind.LineFeed });

    return printer.printList(
      ListFormat.MultiLine,
      factory.createNodeArray(nodeList),
      createSourceFile(this.config.typeOutput.fileName, '', ScriptTarget.ESNext, true, ScriptKind.TS),
    );
  }

  private generateClient() {
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

    for (const [_, method] of this.builtMethodSchemas) {
      [
        method.responseBodySchema,
        method.mergedRequestSchema,
        method.requestBodySchema,
        method.pathParametersSchema,
        method.queryParametersSchema,
      ].forEach((schema) => {
        if (schema?.generatedName) {
          imports.add(schema.generatedName);
        }
      });
    }

    const nodeList: ts.Node[] = [createImportDeclaration(REQUEST_LIBRARY_NAME, [requestInitFn, makeRequestFn])];

    if (this.config.clientOutput.topOfFileComment) {
      nodeList.unshift(
        factory.createJSDocComment(this.config.clientOutput.topOfFileComment),
        factory.createIdentifier('\n'),
      );
    }

    if (imports.size) {
      const importsAsArray = Array.from(imports);

      nodeList.push(createImportDeclaration(typeImportPath, importsAsArray, importsAsArray));
    }

    // Add a newline after the imports
    nodeList.push(factory.createIdentifier('\n'));

    for (const [_, method] of this.builtMethodSchemas) {
      const makeRequestFnTypeNames = [
        method.responseBodySchema?.generatedName,
        method.mergedRequestSchema?.generatedName || method.requestBodySchema?.generatedName,
      ];

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
        factory.createStringLiteral(method.rawMethod.httpMethod.toUpperCase(), true),
        factory.createLogicalOr(factory.createIdentifier('baseUrl'), factory.createStringLiteral('', true)),
        factory.createStringLiteral(method.rawMethod.httpPath, true),
      ];

      switch (this.config.types.requestType) {
        case 'split': {
          const pathParametersParamName = 'pathParameters';
          const queryParametersParamName = 'queryParameters';
          const requestBodyParamName = 'requestBody';

          if (method.pathParametersSchema?.generatedName) {
            makeRequestFnArguments.push(
              factory.createParameterDeclaration(
                undefined,
                undefined,
                factory.createIdentifier(pathParametersParamName),
                optionalFieldMarker,
                factory.createTypeReferenceNode(method.pathParametersSchema.generatedName),
              ),
            );
          }

          requestInitFnArguments.push(
            method.pathParametersSchema?.generatedName
              ? factory.createIdentifier(pathParametersParamName)
              : factory.createIdentifier('undefined'),
          );

          if (method.queryParametersSchema?.generatedName) {
            makeRequestFnArguments.push(
              factory.createParameterDeclaration(
                undefined,
                undefined,
                factory.createIdentifier(queryParametersParamName),
                optionalFieldMarker,
                factory.createTypeReferenceNode(method.queryParametersSchema.generatedName),
              ),
            );
          }

          requestInitFnArguments.push(
            method.queryParametersSchema?.generatedName
              ? factory.createIdentifier(queryParametersParamName)
              : factory.createIdentifier('undefined'),
          );

          if (method.requestBodySchema?.generatedName) {
            makeRequestFnArguments.push(
              factory.createParameterDeclaration(
                undefined,
                undefined,
                factory.createIdentifier(requestBodyParamName),
                optionalFieldMarker,
                factory.createTypeReferenceNode(method.requestBodySchema.generatedName),
              ),
            );
          }

          requestInitFnArguments.push(
            method.requestBodySchema?.generatedName
              ? factory.createIdentifier(requestBodyParamName)
              : factory.createIdentifier('undefined'),
          );

          break;
        }
        case 'merged':
        default: {
          const requestParamName = 'request';

          if (method.mergedRequestSchema?.generatedName) {
            makeRequestFnArguments.push(
              factory.createParameterDeclaration(
                undefined,
                undefined,
                factory.createIdentifier(requestParamName),
                optionalFieldMarker,
                factory.createTypeReferenceNode(method.mergedRequestSchema.generatedName),
              ),
            );
          }

          requestInitFnArguments.push(
            method.mergedRequestSchema?.generatedName
              ? factory.createIdentifier(requestParamName)
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

      const methodName = this.config.client.methodNameWriter(method.rawMethod);

      nodeList.push(
        factory.createFunctionDeclaration(
          [factory.createModifier(SyntaxKind.ExportKeyword), factory.createModifier(SyntaxKind.AsyncKeyword)],
          undefined,
          factory.createIdentifier(methodName),
          undefined,
          makeRequestFnArguments,
          factory.createTypeReferenceNode(
            method.responseBodySchema?.generatedName
              ? `Promise<${method.responseBodySchema.generatedName} | undefined>`
              : 'Promise<undefined>',
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
        method,
      });
    }

    const printer = createPrinter({ newLine: NewLineKind.LineFeed });

    return printer.printList(
      ListFormat.MultiLine,
      factory.createNodeArray(nodeList),
      createSourceFile(this.config.clientOutput.fileName || 'client.ts', '', ScriptTarget.ESNext, true, ScriptKind.TS),
    );
  }

  private populateGenerics(
    schema: ParsedSchemaWithRef,
    schemas: Map<string, ParsedSchema>,
    visited = new Set<string>(),
  ) {
    const schemaName = getFullGRPCName(schema);

    const schemaOverrides = this.schemaGenerics.get(schemaName) || new Map<string, Map<string, GenericOverrideMap>>();
    const properties = getObjectProperties(schema, schemas);

    for (const [propertyName, property] of properties || []) {
      const propertySchemaName = getFullGRPCName(property.schema);

      if (propertySchemaName && !visited.has(propertySchemaName)) {
        const propertyGenerics =
          this.schemaGenerics.get(propertySchemaName) ||
          this.populateGenerics(property.schema, schemas, new Set([...visited, propertySchemaName]));

        if (propertyGenerics?.size) {
          if (!this.schemaGenerics.has(propertySchemaName)) {
            this.schemaGenerics.set(propertySchemaName, propertyGenerics);
          }

          schemaOverrides.set(propertyName, propertyGenerics);
        }
      }
    }

    if (schemaOverrides.size) {
      this.schemaGenerics.set(schemaName, schemaOverrides);
    }

    return schemaOverrides;
  }

  private prepareMethods(source: ParsedSource) {
    for (const pkg of source.packages) {
      for (const service of pkg.services) {
        for (const method of service.methods) {
          const builtMethod = this.prepareMethodTypes(method, source.schemas);

          const schemas = [
            builtMethod.responseBodySchema?.rawSchema,
            builtMethod.mergedRequestSchema?.rawSchema,
            builtMethod.requestBodySchema?.rawSchema,
            builtMethod.pathParametersSchema?.rawSchema,
            builtMethod.queryParametersSchema?.rawSchema,
          ].filter(Boolean) as ParsedSchemaWithRef[];

          for (const schema of schemas) {
            this.populateGenerics(schema, source.schemas);
          }
        }
      }
    }
  }

  public generate(source: ParsedSource) {
    const typesFile = this.generateTypesFile(source);
    const clientFile = this.generateClient();

    return {
      typesFile,
      clientFile,
    };
  }
}

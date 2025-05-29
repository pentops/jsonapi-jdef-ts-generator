import ts, {
  type Node,
  type Expression,
  Identifier,
  type TypeElement,
  type TypeNode,
  TypeParameterDeclaration,
  TypeLiteralNode,
} from 'typescript';
import { match, P } from 'ts-pattern';
import { buildMergedRequestInit, makeRequest } from '@pentops/jsonapi-request';
import type { Config, GenericOverride, GenericOverrideMap, GenericOverrideWithValue } from './config-types';
import {
  cleanRefName,
  getAllGenericsForChildren,
  getFullGRPCName,
  getObjectProperties,
  getPackageSummary,
  getPropertyByPath,
  getScalarTypeForSchema,
  getSchemaName,
  getValidKeyName,
  isCharacterSafeForName,
  isKeyword,
} from './helpers';
import {
  BANG_TYPE_FIELD_NAME,
  DerivedEnumHelperType,
  type ParsedAny,
  type ParsedEnum,
  type ParsedEnumValueDescription,
  type ParsedMethod,
  type ParsedObject,
  type ParsedObjectProperty,
  type ParsedOneOf,
  type ParsedPackage,
  ParsedPolymorph,
  type ParsedRef,
  type ParsedSchema,
  type ParsedSchemaWithRef,
  type ParsedSource,
} from './parsed-types';
import type {
  BuiltMethodSchema,
  GeneratedClientFunction,
  GeneratedClientFunctionWithNodes,
  GeneratedSchema,
  GeneratedSchemaWithNode,
  PackageSummary,
} from './generated-types';
import { getImportPath } from './fs-helpers';
import { buildGenericReferenceNode, createImportDeclaration } from './ts-helpers';

const {
  addSyntheticLeadingComment,
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
const REQUEST_INIT_PARAMETER_NAME = 'requestInit';
const REQUEST_INIT_TYPE_NAME = 'RequestInit';

const optionalFieldMarker = factory.createToken(SyntaxKind.QuestionToken);

const SCALAR_TYPE_TO_SYNTAX_KIND = {
  string: SyntaxKind.StringKeyword,
  boolean: SyntaxKind.BooleanKeyword,
  number: SyntaxKind.NumberKeyword,
} as const;

export class Generator {
  public config: Config;
  private schemaGenerationProspects: Map<string, GeneratedSchemaWithNode> = new Map();
  public builtMethodSchemas: Map<string, BuiltMethodSchema> = new Map();
  public generatedSchemas: Map<string, GeneratedSchemaWithNode> = new Map();
  public generatedClientFunctions: GeneratedClientFunctionWithNodes[] = [];
  public definedAnySchemas: Set<string> = new Set();
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

  private static buildUnionEnum(values: string[]) {
    return factory.createUnionTypeNode(
      values.map((value) => factory.createLiteralTypeNode(factory.createStringLiteral(value, true))),
    );
  }

  private buildEnumKeyValueMap(schema: ParsedEnum, enumType: 'enum' | 'union') {
    return schema.enum.options.reduce<Map<string, string>>((acc, curr) => {
      acc.set(curr.name, enumType === 'enum' ? this.config.types.enumKeyNameWriter(curr.name, schema) : curr.name);

      return acc;
    }, new Map());
  }

  private static generateEnum(name: string, keyValueMap: Map<string, string>, enumType: 'enum' | 'union') {
    switch (enumType) {
      case 'enum': {
        return factory.createEnumDeclaration(
          [factory.createModifier(SyntaxKind.ExportKeyword)],
          factory.createIdentifier(name),
          Array.from(keyValueMap.entries()).map(([key, value]) =>
            factory.createEnumMember(factory.createIdentifier(value), factory.createStringLiteral(key, true)),
          ),
        );
      }
      case 'union': {
        return factory.createTypeAliasDeclaration(
          [factory.createModifier(SyntaxKind.ExportKeyword)],
          factory.createIdentifier(name),
          [],
          Generator.buildUnionEnum(Array.from(keyValueMap.values())),
        );
      }
    }
  }

  private generateOneOfUnionType(
    oneOfGeneratedName: string,
    oneOf: ParsedOneOf,
    schemas: Map<string, ParsedSchema>,
  ): GeneratedSchemaWithNode<ParsedEnum> {
    const oneOfFullGrpcName = getFullGRPCName(oneOf);
    const mockGrpcName = `${oneOfFullGrpcName}OneOfValue`;
    const generatedName = this.config.types.nameWriter(mockGrpcName);
    const values = Array.from(oneOf.oneOf.properties.keys());

    return {
      generatedName,
      fullGrpcName: mockGrpcName,
      generatedValueNames: values.reduce<Map<string, string>>((acc, curr) => {
        acc.set(curr, curr);

        return acc;
      }, new Map()),
      rawSchema: {
        enum: {
          fullGrpcName: mockGrpcName,
          name: generatedName,
          options: values.map((name) => ({
            name,
            genericReferenceToSchema: getPropertyByPath(name, oneOf, schemas),
          })),
          prefix: '',
          derivedHelperType: DerivedEnumHelperType.OneOfTypes,
          package: oneOf.oneOf.package,
          rules: {},
        },
      },
      node: factory.createTypeAliasDeclaration(
        [factory.createModifier(SyntaxKind.ExportKeyword)],
        generatedName,
        undefined,
        factory.createTypeReferenceNode('Exclude', [
          factory.createIndexedAccessTypeNode(
            factory.createTypeReferenceNode(oneOfGeneratedName),
            factory.createLiteralTypeNode(factory.createStringLiteral(BANG_TYPE_FIELD_NAME, true)),
          ),
          factory.createKeywordTypeNode(SyntaxKind.UndefinedKeyword),
        ]),
      ),
    };
  }

  private static buildSchemaTypeParameterDeclarations(
    generics: GenericOverrideWithValue[] | undefined,
  ): TypeParameterDeclaration[] | undefined {
    if (!generics?.length) {
      return undefined;
    }

    const declarations: TypeParameterDeclaration[] = [];

    for (let i = generics.length - 1; i >= 0; i -= 1) {
      if (generics[i].value === undefined) {
        declarations.unshift(Generator.buildGenericNodeFromDefinition(generics[i]));
      }
    }

    return declarations;
  }

  private static buildPackageSummary(pkg: ParsedPackage): PackageSummary {
    return {
      package: pkg.name,
      label: pkg.label,
    };
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
    const typeArguments: TypeNode[] = [];

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
        .with({ bool: P.not(P.nullish) }, (s) => ({
          node: factory.createKeywordTypeNode(SCALAR_TYPE_TO_SYNTAX_KIND[getScalarTypeForSchema(s) || 'boolean']),
        }))
        // all nested enums are union types
        .with({ enum: P.not(P.nullish) }, (s) => {
          return { node: Generator.buildUnionEnum(Array.from(this.buildEnumKeyValueMap(s, 'union').keys())) };
        })
        .with({ key: P.not(P.nullish) }, (s) => {
          const format = match(s.key.format)
            .with({ uuid: P.not(P.nullish) }, () => 'uuid')
            .with({ informal: P.not(P.nullish) }, () => 'informal')
            .with({ id62: P.not(P.nullish) }, () => 'id62')
            .with(
              { custom: P.not(P.nullish) },
              (c) => `custom${c.custom.pattern ? ` - pattern: ${c.custom.pattern}` : ''}`,
            )
            .otherwise(() => undefined);

          return {
            node: factory.createKeywordTypeNode(SCALAR_TYPE_TO_SYNTAX_KIND[getScalarTypeForSchema(s) || 'string']),
            comment: format ? `format: ${format}` : undefined,
          };
        })
        .with({ string: P.not(P.nullish) }, (s) => ({
          node: s.string.literalValue
            ? factory.createLiteralTypeNode(factory.createStringLiteral(s.string.literalValue, true))
            : factory.createKeywordTypeNode(SCALAR_TYPE_TO_SYNTAX_KIND[getScalarTypeForSchema(s) || 'string']),
          comment:
            [
              s.string.format ? `format: ${s.string.format}` : undefined,
              s.string.rules?.pattern ? `pattern: ${s.string.rules.pattern}` : undefined,
            ]
              .filter(Boolean)
              .join(', ') || undefined,
        }))
        .with({ date: P.not(P.nullish) }, (s) => ({
          node: factory.createKeywordTypeNode(SCALAR_TYPE_TO_SYNTAX_KIND[getScalarTypeForSchema(s) || 'string']),
          comment: 'format: YYYY-MM-DD',
        }))
        .with({ timestamp: P.not(P.nullish) }, (s) => ({
          node: factory.createKeywordTypeNode(SCALAR_TYPE_TO_SYNTAX_KIND[getScalarTypeForSchema(s) || 'string']),
          comment: 'format: date-time',
        }))
        .with({ decimal: P.not(P.nullish) }, (s) => ({
          node: factory.createKeywordTypeNode(SCALAR_TYPE_TO_SYNTAX_KIND[getScalarTypeForSchema(s) || 'string']),
          comment: 'format: decimal',
        }))
        .with({ integer: P.not(P.nullish) }, (s) => ({
          node: factory.createKeywordTypeNode(SCALAR_TYPE_TO_SYNTAX_KIND[getScalarTypeForSchema(s) || 'number']),
          comment: s.integer.format ? `format: ${s.integer.format}` : undefined,
        }))
        .with({ float: P.not(P.nullish) }, (s) => ({
          node: factory.createKeywordTypeNode(SCALAR_TYPE_TO_SYNTAX_KIND[getScalarTypeForSchema(s) || 'number']),
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

          return { node: factory.createUnionTypeNode(this.buildOneOfUnionMembers(s, schemaGenerics, genericValues)) };
        })
        .with({ array: P.not(P.nullish) }, (s) => {
          const { node, comment } = this.buildBaseType(s.array.itemSchema, genericValues);

          return { node: factory.createArrayTypeNode(node), comment };
        })
        .with({ bytes: P.not(P.nullish) }, (s) => ({
          node: factory.createKeywordTypeNode(SCALAR_TYPE_TO_SYNTAX_KIND[getScalarTypeForSchema(s) || 'string']),
          comment: 'bytes (base64-encoded)',
        }))
        .with({ any: P.not(P.nullish) }, (s) => ({ node: this.buildAnyType(s, genericValues) }))
        .with({ polymorph: P.not(P.nullish) }, (s) => ({ node: this.buildPolymorphType(s, genericValues) }))
        .otherwise(() => {
          console.log('Unknown schema type', schema);
          return { node: factory.createKeywordTypeNode(SyntaxKind.AnyKeyword) };
        })
    );
  }

  private buildPolymorphType(polymorphSchema: ParsedPolymorph, genericValues?: GenericOverrideWithValue[]) {
    if (!polymorphSchema.polymorph.properties?.size) {
      return factory.createKeywordTypeNode(SyntaxKind.AnyKeyword);
    }

    return factory.createUnionTypeNode(
      Array.from(polymorphSchema.polymorph.properties.entries()).map(([type, properties]) => {
        const schemaGenerics = this.schemaGenerics.get(type);

        const members: (TypeElement | Identifier)[] = [];

        for (const [name, property] of properties) {
          members.push(this.buildBaseObjectMember(name, property, schemaGenerics, genericValues));
        }

        return factory.createTypeLiteralNode(members as readonly TypeElement[]);
      }),
    );
  }

  private buildAnyType(anySchema: ParsedAny, genericValues?: GenericOverrideWithValue[]) {
    if (!anySchema.any.properties?.size) {
      return factory.createKeywordTypeNode(SyntaxKind.AnyKeyword);
    }

    return factory.createUnionTypeNode(
      Array.from(anySchema.any.properties.entries()).map(([type, properties]) => {
        const schemaGenerics = this.schemaGenerics.get(type);

        const members: (TypeElement | Identifier)[] = [];

        for (const [name, property] of properties) {
          members.push(this.buildBaseObjectMember(name, property, schemaGenerics, genericValues));
        }

        this.definedAnySchemas.add(type);

        return factory.createTypeLiteralNode(members as readonly TypeElement[]);
      }),
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

    if (validKeyName !== name && name !== BANG_TYPE_FIELD_NAME) {
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

  private buildOneOfUnionMembers(
    schema: ParsedOneOf,
    generics?: GenericOverrideMap,
    genericValues?: GenericOverrideWithValue[],
  ) {
    const literals: TypeLiteralNode[] = [];

    for (const [name, property] of schema.oneOf.properties) {
      literals.push(
        factory.createTypeLiteralNode([
          factory.createPropertySignature(
            undefined,
            factory.createStringLiteral(BANG_TYPE_FIELD_NAME, true),
            optionalFieldMarker, // it's always going to be present, but needs to be optional for request types
            factory.createLiteralTypeNode(factory.createStringLiteral(name, true)),
          ),
          // The oneOf property itself should be required
          this.buildBaseObjectMember(name, { ...property, required: true }, generics, genericValues),
        ]),
      );
    }

    return literals;
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
    schemas: Map<string, ParsedSchema>,
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
      .with({ object: P.not(P.nullish) }, (s) => [
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
      ])
      .with({ oneOf: P.not(P.nullish) }, (s) => {
        const oneOfUnionType = this.generateOneOfUnionType(generatedName, s, schemas);

        return [
          {
            generatedName,
            rawSchema: s,
            fullGrpcName,
            derivedOneOfTypeEnum: oneOfUnionType,
            node: factory.createTypeAliasDeclaration(
              [factory.createModifier(SyntaxKind.ExportKeyword)],
              factory.createIdentifier(generatedName),
              Generator.buildSchemaTypeParameterDeclarations(allGenericsWithValues),
              factory.createUnionTypeNode(this.buildOneOfUnionMembers(s, schemaGenerics, allGenericsWithValues)),
            ),
          },
          oneOfUnionType,
        ];
      })
      .with({ enum: P.not(P.nullish) }, (s) => {
        const keyValueMap = this.buildEnumKeyValueMap(s, this.config.types.enumType);

        return [
          {
            generatedName,
            fullGrpcName,
            rawSchema: s,
            generatedValueNames: keyValueMap,
            node: Generator.generateEnum(generatedName, keyValueMap, this.config.types.enumType),
          },
        ];
      })
      .with({ polymorph: P.not(P.nullish) }, (s) => [
        {
          generatedName,
          rawSchema: s,
          fullGrpcName,
          node: factory.createTypeAliasDeclaration(
            [factory.createModifier(SyntaxKind.ExportKeyword)],
            factory.createIdentifier(generatedName),
            Generator.buildSchemaTypeParameterDeclarations(allGenericsWithValues),
            this.buildPolymorphType(s),
          ),
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
      this.builtMethodSchemas.get(method.fullGrpcName) ||
      ({
        rawMethod: method,
        parentPackage: Generator.buildPackageSummary(method.parentService.parentPackage),
      } as BuiltMethodSchema);

    const relatedEntity = method.relatedEntity?.schemaFullGrpcName
      ? this.schemaGenerationProspects.get(method.relatedEntity.schemaFullGrpcName)
      : undefined;

    if (relatedEntity) {
      builtMethod.relatedEntity = relatedEntity as GeneratedSchema<ParsedObject>;
    }

    const rootEntity = this.schemaGenerationProspects.get(getFullGRPCName(method.rootEntitySchema));

    if (rootEntity) {
      builtMethod.rootEntitySchema = rootEntity as GeneratedSchema<ParsedObject>;
    }

    if (responseBody) {
      builtMethod.responseBodySchema = {
        generatedName: this.getValidTypeName(responseBody),
        rawSchema: responseBody,
        parentPackage: builtMethod.parentPackage,
      };
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

    if (method.pathParameters?.size) {
      method.pathParameters.forEach((param) => {
        mergedSchema.object.properties.set(param.name, param);
      });
    }

    if (method.queryParameters?.size) {
      method.queryParameters.forEach((param) => {
        mergedSchema.object.properties.set(param.name, param);
      });
    }

    if (mergedSchema.object.properties.size) {
      builtMethod.mergedRequestSchema = {
        generatedName: this.getValidTypeName(mergedSchema, requestBaseName),
        rawSchema: mergedSchema,
        parentPackage: builtMethod.parentPackage,
      };
    }

    if (method.listOptions) {
      builtMethod.list = {};

      const createGenericEnum = (
        fieldType: DerivedEnumHelperType,
        values: string[],
      ): GeneratedSchemaWithNode<ParsedEnum> => {
        const mockGrpcName = `${method.fullGrpcName.replaceAll('/', '')}${match(fieldType)
          .with(DerivedEnumHelperType.FilterFields, () => 'Filterable')
          .with(DerivedEnumHelperType.SearchFields, () => 'Searchable')
          .with(DerivedEnumHelperType.SortFields, () => 'Sortable')
          .otherwise(() => '')}Fields`;
        const schema: ParsedEnum = {
          enum: {
            fullGrpcName: mockGrpcName,
            name: this.config.types.nameWriter(mockGrpcName),
            prefix: '',
            options: values.map((value) => {
              const base: ParsedEnumValueDescription<ParsedSchema> = { name: value };

              if (rootEntity) {
                const matchingValue = getPropertyByPath(value, rootEntity.rawSchema, schemas);

                if (matchingValue) {
                  base.genericReferenceToSchema = matchingValue;
                } else {
                  console.warn(
                    `[jdef-ts-generator]: unable to find property ${value} in related entity ${rootEntity.generatedName} for method: ${method.name}`,
                  );
                }
              }

              return base;
            }),
            rules: {},
            derivedHelperType: fieldType,
          },
        };

        return this.buildType(schema, schemas)?.[0] as GeneratedSchemaWithNode<ParsedEnum>;
      };

      if (method.listOptions.defaultFilters) {
        builtMethod.list.defaultFilters = method.listOptions.defaultFilters;
      }

      if (method.listOptions.defaultSorts) {
        builtMethod.list.defaultSorts = method.listOptions.defaultSorts;
      }

      if (method.listOptions.filterableFields?.length) {
        builtMethod.list.filterableFields = createGenericEnum(
          DerivedEnumHelperType.FilterFields,
          method.listOptions.filterableFields.map((field) => field.name),
        );
      }

      if (method.listOptions.searchableFields?.length) {
        builtMethod.list.searchableFields = createGenericEnum(
          DerivedEnumHelperType.SearchFields,
          method.listOptions.searchableFields,
        );
      }

      if (method.listOptions.sortableFields?.length) {
        builtMethod.list.sortableFields = createGenericEnum(
          DerivedEnumHelperType.SortFields,
          method.listOptions.sortableFields.map((field) => field.name),
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
  ): GeneratedSchemaWithNode[] | undefined {
    const nodes: GeneratedSchemaWithNode[] = [];

    if (schema) {
      const schemaName = getSchemaName(schema, schemas);
      const typeName = this.getValidTypeName(schema, schemaName);
      const typeNodes = this.generateSchema(typeName, schema, schemas, parentMethod);

      typeNodes?.forEach((node) => {
        this.schemaGenerationProspects.set(node.fullGrpcName || node.generatedName || schemaName, {
          ...node,
          generatedName: node.generatedName || schemaName,
          rawSchema: node.rawSchema || schema,
          parentPackage: parentMethod?.parentPackage || getPackageSummary(node.rawSchema),
          node: node.node,
        });

        nodes.push(node);
      });
    }

    return nodes;
  }

  private buildMethodTypes(builtMethod: BuiltMethodSchema, schemas: Map<string, ParsedSchema>) {
    // Add listify generic values
    if (builtMethod.list) {
      for (const listSchema of Object.values(builtMethod.list || {})) {
        this.buildType(listSchema.rawSchema, schemas, builtMethod);
      }
    }

    const methodSchemas = [
      builtMethod.responseBodySchema?.rawSchema,
      builtMethod.mergedRequestSchema?.rawSchema,
    ].filter(Boolean) as ParsedSchema[];

    for (const methodSchema of methodSchemas) {
      this.buildType(methodSchema, schemas, builtMethod);
    }
  }

  private prepareSchemaTypes(source: ParsedSource) {
    for (const [_, schema] of source.schemas) {
      this.populateGenerics(schema, source.schemas);
      this.buildType(schema, source.schemas);
    }
  }

  private generateTypesFile(source: ParsedSource) {
    this.prepareSchemaTypes(source);
    this.prepareMethods(source);

    const nodeList: Node[] = this.config.typeOutput.topOfFileComment
      ? [factory.createJSDocComment(this.config.typeOutput.topOfFileComment), factory.createIdentifier('\n')]
      : [];

    // Generate request and response types for each method
    for (const [_, method] of this.builtMethodSchemas) {
      this.buildMethodTypes(method, source.schemas);
    }

    for (const [schemaName, schema] of this.schemaGenerationProspects) {
      nodeList.push(schema.node, factory.createIdentifier('\n'));
      this.generatedSchemas.set(schemaName, schema);
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

    const requestInitFn = buildMergedRequestInit.name;

    const makeRequestFn = makeRequest.name;

    const imports = new Set<string>();

    for (const [_, method] of this.builtMethodSchemas) {
      [method.responseBodySchema, method.mergedRequestSchema].forEach((schema) => {
        if (schema?.generatedName) {
          imports.add(schema.generatedName);
        }
      });
    }

    const nodeList: Node[] = [createImportDeclaration(REQUEST_LIBRARY_NAME, [requestInitFn, makeRequestFn])];

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
        method.mergedRequestSchema?.generatedName,
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
        factory.createIdentifier(REQUEST_INIT_PARAMETER_NAME),
      );

      makeRequestFnArguments.push(
        factory.createParameterDeclaration(
          undefined,
          undefined,
          factory.createIdentifier(REQUEST_INIT_PARAMETER_NAME),
          optionalFieldMarker,
          factory.createTypeReferenceNode(REQUEST_INIT_TYPE_NAME),
        ),
      );

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

      const addGeneratedTypesWithNodesToMethod = (
        method: GeneratedClientFunction,
      ): GeneratedClientFunctionWithNodes => {
        const getSchemaWithNode = <TSchema extends ParsedSchema>(
          schema: GeneratedSchema<TSchema> | undefined,
        ): GeneratedSchemaWithNode<TSchema> | undefined => {
          return (
            schema
              ? this.generatedSchemas.get(getFullGRPCName(schema.rawSchema) || schema.generatedName) || schema
              : undefined
          ) as GeneratedSchemaWithNode<TSchema> | undefined;
        };

        return {
          ...method,
          method: {
            ...method.method,
            responseBodySchema: getSchemaWithNode(method.method.responseBodySchema),
            mergedRequestSchema: getSchemaWithNode(method.method.mergedRequestSchema),
            list: method.method.list
              ? {
                  defaultFilters: method.method.list.defaultFilters,
                  defaultSorts: method.method.list.defaultSorts,
                  filterableFields: getSchemaWithNode(method.method.list.filterableFields),
                  searchableFields: getSchemaWithNode(method.method.list.searchableFields),
                  sortableFields: getSchemaWithNode(method.method.list.sortableFields),
                }
              : undefined,
            relatedEntity: getSchemaWithNode(method.method.relatedEntity),
            rootEntitySchema: getSchemaWithNode(method.method.rootEntitySchema),
          },
        };
      };

      this.generatedClientFunctions.push(addGeneratedTypesWithNodesToMethod({ generatedName: methodName, method }));
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

    return { typesFile, clientFile };
  }
}

import { match, P } from 'ts-pattern';
import { JDEF, JDEFMethod, JDEFObjectProperty, JDEFPackage, JDEFParameter, JDEFSchemaWithRef } from './jdef-types';
import {
  ParsedAny,
  ParsedArray,
  ParsedAuthType,
  ParsedBool,
  ParsedBytes,
  ParsedEntity,
  ParsedEnum,
  ParsedFloat,
  ParsedInteger,
  ParsedKey,
  ParsedMap,
  ParsedMethodListOptions,
  ParsedObject,
  ParsedObjectProperty,
  ParsedOneOf,
  ParsedPackage,
  ParsedRef,
  ParsedSchema,
  ParsedSchemaWithRef,
  ParsedService,
  ParsedSource,
  ParsedString,
  SortDirection,
} from './parsed-types';
import { constantCase } from 'change-case';
import {
  APIArraySchema,
  APIMethod,
  APIMethodAuthType,
  APIObjectProperty,
  APIObjectSchema,
  APIObjectValue,
  APIPackage,
  APIRefValue,
  APIRequestListOptions,
  APIRootSchema,
  APISchema,
  APIService,
  APISource,
  APIStateEntity,
} from './api-types';
import { EntityPart, HTTPMethod, SortingConstraintValue } from './shared-types';
import { getObjectProperties, JSON_SCHEMA_REFERENCE_PREFIX } from './helpers';
import { PackageSummary } from './generated-types';

export function jdefParameterToSource(parameter: JDEFParameter): ParsedObjectProperty | undefined {
  const converted = jdefSchemaToSource(parameter?.schema);

  if (!converted) {
    return undefined;
  }

  return {
    ...parameter,
    schema: converted,
  };
}

export function jdefObjectPropertyToSource(
  property: JDEFObjectProperty,
  name: string,
  parentObjectName: string | undefined,
): ParsedObjectProperty | undefined {
  const converted = jdefSchemaToSource(property, parentObjectName);

  if (!converted) {
    return undefined;
  }

  return {
    name,
    schema: converted,
    ...property,
  };
}

function jdefPackageToSummary(pkg: JDEFPackage | undefined): PackageSummary | undefined {
  if (!pkg) {
    return undefined;
  }

  return {
    package: pkg.name,
    label: pkg.label,
  };
}

export function jdefSchemaToSource(
  schema: JDEFSchemaWithRef,
  schemaName?: string,
  pkg?: JDEFPackage,
): ParsedSchemaWithRef | undefined {
  const typeName = schemaName?.split('.').pop() || schemaName || '';
  const fullName = schemaName || '';

  return match(schema)
    .with(
      { $ref: P.string },
      (r) =>
        ({
          $ref: r.$ref.replace('#/definitions/', JSON_SCHEMA_REFERENCE_PREFIX),
        }) as ParsedRef,
    )
    .with(
      { type: 'boolean' },
      (b) =>
        ({
          bool: {
            const: false,
            example: b.example,
          },
        }) as ParsedBool,
    )
    .with(
      { enum: P.array(P.string) },
      (e) =>
        ({
          enum: {
            fullGrpcName: fullName,
            name: typeName,
            prefix: schemaName ? `${constantCase(schemaName)}_` : undefined,
            example: e.example,
            rules: {},
            package: jdefPackageToSummary(pkg),
            options: e.enum.map((option) => {
              const matchedMetadata = e['x-enum']?.find((metadata) => metadata.name === option);

              return {
                name: matchedMetadata?.name || option,
                description: matchedMetadata?.description,
                number: matchedMetadata?.number,
              };
            }),
          },
        }) as ParsedEnum,
    )
    .with(
      { type: 'string' },
      (s) =>
        ({
          string: {
            example: s.example,
            format: s.format,
            rules: {
              minLength: s.minLength,
              maxLength: s.maxLength,
              pattern: s.pattern,
            },
          },
        }) as ParsedString,
    )
    .with({ type: 'number' }, (n) => {
      if (n.format?.startsWith('int')) {
        return {
          integer: {
            example: n.example,
            format: n.format,
            rules: {
              minimum: n.minimum,
              maximum: n.maximum,
              exclusiveMaximum: n.exclusiveMaximum,
              exclusiveMinimum: n.exclusiveMinimum,
              multipleOf: n.multipleOf,
            },
          },
        } as ParsedInteger;
      }

      return {
        float: {
          example: n.example,
          format: n.format,
          rules: {
            minimum: n.minimum,
            maximum: n.maximum,
            exclusiveMaximum: n.exclusiveMaximum,
            exclusiveMinimum: n.exclusiveMinimum,
            multipleOf: n.multipleOf,
          },
        },
      } as ParsedFloat;
    })
    .with(
      { type: 'integer' },
      (i) =>
        ({
          integer: {
            example: i.example,
            format: i.format,
            rules: {
              minimum: i.minimum,
              maximum: i.maximum,
              exclusiveMaximum: i.exclusiveMaximum,
              exclusiveMinimum: i.exclusiveMinimum,
              multipleOf: i.multipleOf,
            },
          },
        }) as ParsedInteger,
    )
    .with({ type: 'object' }, (o) => {
      if (o.additionalProperties === true) {
        return { any: { example: o.example } } as ParsedAny;
      }

      if (o.additionalProperties) {
        return {
          map: {
            example: o.example,
            itemSchema: jdefSchemaToSource(o.additionalProperties, undefined, pkg),
            keySchema: o['x-key-property'] ? jdefSchemaToSource(o['x-key-property'], undefined, pkg) : undefined,
          },
        } as ParsedMap;
      }

      const packageSummary = jdefPackageToSummary(pkg);

      function buildParsedProperties(properties: Record<string, JDEFObjectProperty> | undefined) {
        return Object.entries(properties || {}).reduce<Map<string, ParsedObjectProperty>>(
          (acc, [propertyName, property]) => {
            const converted = jdefObjectPropertyToSource(property, propertyName, fullName);

            if (!converted) {
              return acc;
            }

            acc.set(converted.name, converted);

            return acc;
          },
          new Map(),
        );
      }

      if (o['x-is-oneof']) {
        return {
          oneOf: {
            example: o.example,
            fullGrpcName: fullName,
            description: o.description,
            name: o['x-name'] || typeName,
            properties: buildParsedProperties(o.properties),
            package: packageSummary,
          },
        } as ParsedOneOf;
      }

      return {
        object: {
          example: o.example,
          fullGrpcName: fullName,
          description: o.description,
          name: o['x-name'] || typeName,
          properties: buildParsedProperties(o.properties),
          rules: {
            minProperties: o.minProperties,
            maxProperties: o.maxProperties,
          },
          package: packageSummary,
        },
      } as ParsedObject;
    })
    .with(
      { type: 'array' },
      (a) =>
        ({
          array: {
            example: a.example,
            itemSchema: jdefSchemaToSource(a.items, undefined, pkg),
            rules: {
              minItems: a.minItems,
              maxItems: a.maxItems,
              uniqueItems: a.uniqueItems,
            },
          },
        }) as ParsedArray,
    )
    .otherwise(() => {
      console.warn(`[jdef-ts-generator]: unsupported schema type while parsing jdef source: ${schema}`);
      return undefined;
    });
}

function getJdefMethodRequestResponseFullGrpcName(method: JDEFMethod, requestOrResponse: JDEFSchemaWithRef): string {
  const grpcNameBase = method.fullGrpcName.split('/').slice(0, -1).join('/');

  return match(requestOrResponse)
    .with({ 'x-name': P.not(P.nullish) }, (o) => `${grpcNameBase}/${o['x-name']}`)
    .otherwise(() => '');
}

export function parseJdefSource(source: JDEF): ParsedSource {
  const metadata: ParsedSource['metadata'] = {
    builtAt: null,
    version: undefined,
  };

  if (source.metadata.built_at) {
    metadata.builtAt = new Date(source.metadata.built_at.seconds * 1000 + source.metadata.built_at.nanos / 1_000_000);
  }

  const parsed: ParsedSource = {
    metadata,
    packages: [],
    schemas: new Map(),
  };

  for (const schemaName in source.definitions) {
    // TODO: match package
    const parsedSchema = jdefSchemaToSource(source.definitions[schemaName], schemaName);

    if (parsedSchema) {
      parsed.schemas.set(schemaName, parsedSchema as ParsedSchema);
    }
  }

  for (const pkg of source.packages) {
    const parsedPackage: ParsedPackage = {
      name: pkg.name,
      label: pkg.label,
      introduction: pkg.introduction,
      hidden: pkg.hidden,
      services: [],
    };

    for (const method of pkg.methods) {
      function mapParameters(parameters: JDEFParameter[] | undefined) {
        return parameters?.reduce<Map<string, ParsedObjectProperty>>((acc, parameter) => {
          const converted = jdefParameterToSource(parameter);

          if (!converted) {
            return acc;
          }

          acc.set(converted.name, converted);

          return acc;
        }, new Map());
      }

      let service = parsedPackage.services.find((service) => service.name === method.grpcServiceName);
      if (!service) {
        service = {
          name: method.grpcServiceName,
          methods: [],
          parentPackage: parsedPackage,
          fullGrpcName: `${parsedPackage.name}.${method.grpcServiceName}`,
        };

        parsedPackage.services.push(service);
      }

      service.methods.push({
        name: method.grpcMethodName,
        fullGrpcName: method.fullGrpcName,
        httpMethod: method.httpMethod,
        httpPath: method.httpPath,
        responseBody: method.responseBody
          ? jdefSchemaToSource(
              method.responseBody,
              getJdefMethodRequestResponseFullGrpcName(method, method.responseBody),
              pkg,
            )
          : undefined,
        requestBody: method.requestBody
          ? jdefSchemaToSource(
              method.requestBody,
              getJdefMethodRequestResponseFullGrpcName(method, method.requestBody),
              pkg,
            )
          : undefined,
        pathParameters: mapParameters(method.pathParameters),
        queryParameters: mapParameters(method.queryParameters),
        parentService: service,
        auth: undefined,
      });
    }

    if (parsedPackage.services.length) {
      parsed.packages.push(parsedPackage);
    }
  }

  return parsed;
}

export function apiObjectPropertyToSource(
  property: APIObjectProperty,
  stateEntities: APIStateEntity[],
  schemas: Map<string, APISchema>,
): ParsedObjectProperty | undefined {
  const converted = apiSchemaToSource(property.schema, stateEntities, schemas);

  if (!converted) {
    return undefined;
  }

  return {
    ...property,
    schema: converted,
  };
}

function mapApiStateEntity(entity: APIStateEntity | undefined, part?: EntityPart): ParsedEntity | undefined {
  if (!entity) {
    return undefined;
  }

  return {
    stateEntityFullName: entity.fullName,
    schemaFullGrpcName: entity.schemaName,
    entity: entity.name,
    part: part || EntityPart.Unspecified,
    primaryKeys: entity.primaryKey,
    events: entity.events,
    queryMethods: entity.queryService?.methods?.map((method) => method.fullGrpcName),
    commandMethods: entity.commandServices?.flatMap(
      (service) => service.methods?.map((method) => method.fullGrpcName) || [],
    ),
  };
}

function getFullGrpcPathForSchemaRef(ref: APIRefValue): string {
  return `${ref.package}.${ref.schema}`;
}

function getRefPathForApiSchemaRef(ref: APIRefValue): string {
  return `${JSON_SCHEMA_REFERENCE_PREFIX}${getFullGrpcPathForSchemaRef(ref)}`;
}

function buildApiSchemaRef(ref: APIRefValue): ParsedRef {
  return { $ref: getRefPathForApiSchemaRef(ref) };
}

function addEntityDataToApiPrimaryKeys(
  entity: ParsedEntity | undefined,
  mappedProperties: Map<string, ParsedObjectProperty>,
): Map<string, ParsedObjectProperty> {
  if (entity && entity.primaryKeys?.length) {
    const getPrimaryKeyProperty = (primaryKey: string) => {
      const keyParts = primaryKey.split('.');
      let properties = mappedProperties;

      for (let i = 0; i <= keyParts.length; i += 1) {
        const prospect = properties.get(keyParts[i]);

        if (prospect) {
          const keySchemaMatch = match(prospect)
            .returnType<ParsedKey | undefined>()
            .with({ schema: { key: P.not(P.nullish) } }, (k) => k.schema)
            .otherwise(() => undefined);

          if (keySchemaMatch) {
            return keySchemaMatch;
          }

          const subProperties = getObjectProperties(prospect.schema);

          if (!subProperties?.size) {
            return;
          }

          properties = subProperties;
        }
      }
    };

    for (const primaryKey of entity.primaryKeys) {
      const primaryKeyProperty = getPrimaryKeyProperty(primaryKey);

      if (primaryKeyProperty) {
        primaryKeyProperty.key.primary = primaryKeyProperty.key.primary ?? true;
        primaryKeyProperty.key.entity = primaryKeyProperty.key.entity ?? entity.stateEntityFullName;
      }
    }
  }

  return mappedProperties;
}

export function apiPackageToSummary(pkg?: APIPackage): PackageSummary | undefined {
  if (!pkg) {
    return undefined;
  }

  return {
    package: pkg.name,
    label: pkg.label,
  };
}

export type APISchemaWithPackage = APISchema & {
  package: APIPackage;
};

export function apiSchemaToSource(
  schema: APISchema,
  stateEntities: APIStateEntity[],
  schemas: Map<string, APISchema>,
  fullGrpcName?: string,
  pkg?: APIPackage,
): ParsedSchemaWithRef | undefined {
  function mapObjectProperties(properties: APIObjectProperty[] | undefined) {
    return (properties || []).reduce<Map<string, ParsedObjectProperty>>((acc, curr) => {
      const mappedValue = apiObjectPropertyToSource(curr, stateEntities, schemas);

      if (mappedValue) {
        acc.set(mappedValue.name, mappedValue);
      }

      return acc;
    }, new Map());
  }

  return match(schema)
    .with({ '!type': 'enum' }, (e) =>
      match(e.enum)
        .with({ ref: P.not(P.nullish) }, (enumWithRef) => buildApiSchemaRef(enumWithRef.ref))
        .with(
          P.not(P.nullish),
          (eWithEnum) =>
            ({
              enum: {
                fullGrpcName,
                name: eWithEnum.name,
                prefix: eWithEnum.prefix,
                rules: eWithEnum.rules,
                listRules: eWithEnum.listRules,
                docs: eWithEnum.docs,
                package: apiPackageToSummary(pkg),
                options: eWithEnum.options.map((option) => ({
                  name: option.name,
                  description: option.description,
                  number: option.number,
                })),
              },
            }) as ParsedEnum,
        )
        .otherwise(() => undefined),
    )
    .with(
      { '!type': 'bool' },
      (b) =>
        ({
          bool: {
            rules: b.bool.rules || {},
            listRules: b.bool.listRules || {},
          },
        }) as ParsedBool,
    )
    .with(
      { '!type': 'integer' },
      (i) =>
        ({
          integer: {
            format: i.integer.format,
            rules: i.integer.rules || {},
            listRules: i.integer.listRules || {},
          },
        }) as ParsedInteger,
    )
    .with(
      { '!type': 'float' },
      (f) =>
        ({
          float: {
            format: f.float.format,
            rules: f.float.rules || {},
            listRules: f.float.listRules || {},
          },
        }) as ParsedFloat,
    )
    .with(
      { '!type': 'string' },
      (s) =>
        ({
          string: {
            format: s.string.format,
            rules: s.string.rules || {},
            listRules: s.string.listRules || {},
          },
        }) as ParsedString,
    )
    .with(
      { '!type': 'date' },
      (s) =>
        ({
          string: {
            format: 'date',
            rules: s.date.rules || {},
            listRules: s.date.listRules || {},
          },
        }) as ParsedString,
    )
    .with(
      { '!type': 'timestamp' },
      (s) =>
        ({
          string: {
            format: 'date-time',
            rules: s.timestamp.rules || {},
            listRules: s.timestamp.listRules || {},
          },
        }) as ParsedString,
    )
    .with(
      { '!type': 'decimal' },
      (s) =>
        ({
          string: {
            format: 'decimal',
            rules: s.decimal.rules || {},
          },
        }) as ParsedString,
    )
    .with({ '!type': 'oneof' }, (o) =>
      match(o.oneof)
        .with({ ref: P.not(P.nullish) }, (oneOfWithRef) => buildApiSchemaRef(oneOfWithRef.ref))
        .with(
          P.not(P.nullish),
          (oneOf) =>
            ({
              oneOf: {
                fullGrpcName,
                description: oneOf.description,
                name: oneOf.name,
                properties: mapObjectProperties(oneOf.properties),
                rules: oneOf.rules,
                listRules: oneOf.listRules || {},
                package: apiPackageToSummary(pkg),
              },
            }) as ParsedOneOf,
        )
        .otherwise(() => undefined),
    )
    .with({ '!type': 'object' }, (o) =>
      match(o.object)
        .with({ ref: P.not(P.nullish) }, (objectWithRef) => buildApiSchemaRef(objectWithRef.ref))
        .with(P.not(P.nullish), (obj) => {
          const matchingStateEntity = stateEntities.find((entity) => entity.schemaName === fullGrpcName);
          const entity: ParsedEntity | undefined =
            obj.entity || matchingStateEntity
              ? ({
                  stateEntityFullName: matchingStateEntity?.fullName,
                  name: matchingStateEntity?.name || obj.entity?.entity || '',
                  schemaFullGrpcName: fullGrpcName,
                  ...mapApiStateEntity(matchingStateEntity, obj.entity?.part || EntityPart.Unspecified),
                } as ParsedEntity)
              : undefined;

          const mappedProperties = mapObjectProperties(obj.properties);

          return {
            object: {
              fullGrpcName,
              name: obj.name,
              description: obj.description,
              additionalProperties: obj.additionalProperties,
              properties: addEntityDataToApiPrimaryKeys(entity, mappedProperties),
              rules: obj.rules,
              entity,
              package: apiPackageToSummary(pkg),
            },
          } as ParsedObject;
        })
        .otherwise(() => undefined),
    )
    .with({ '!type': 'any' }, () => ({ any: {} }) as ParsedAny)
    .with({ '!type': 'map' }, (m) => {
      const convertedItemSchema = apiSchemaToSource(m.map.itemSchema, stateEntities, schemas, undefined, pkg);

      if (!convertedItemSchema) {
        return undefined;
      }

      const convertedKeySchema = apiSchemaToSource(m.map.keySchema, stateEntities, schemas, undefined, pkg) || {
        '!type': 'string',
        'string': {},
      };

      return {
        map: {
          itemSchema: convertedItemSchema,
          keySchema: convertedKeySchema,
          rules: m.map.rules || {},
        },
      } as ParsedMap;
    })
    .with({ '!type': 'array' }, (a) => {
      const converted = apiSchemaToSource(a.array.items, stateEntities, schemas, undefined, pkg);

      if (!converted) {
        return undefined;
      }

      return {
        array: {
          itemSchema: converted,
          singleForm: a.array.ext?.singleForm,
          rules: a.array.rules || {},
        },
      } as ParsedArray;
    })
    .with({ '!type': 'bytes' }, (b) => ({ bytes: { rules: b.bytes.rules } }) as ParsedBytes)
    .with(
      { '!type': 'key' },
      (k) =>
        ({
          key: {
            format: k.key.format,
            primary: k.key.ext?.primaryKey || false,
            entity: k.key.entity,
            rules: k.key.rules,
            listRules: k.key.listRules || {},
          },
        }) as ParsedKey,
    )
    .otherwise(() => {
      console.warn(`[jdef-ts-generator]: unsupported schema type while parsing api source: ${schema}`);
      return undefined;
    });
}

function getApiMethodRequestResponseFullGrpcName(method: APIMethod, requestOrResponse: APIRootSchema): string {
  const grpcNameBase = method.fullGrpcName.split('/').slice(0, -1).join('/');

  return match(requestOrResponse)
    .with({ object: { name: P.string } }, (o) => `${grpcNameBase}/${o.object.name}`)
    .with({ oneof: { name: P.string } }, (o) => `${grpcNameBase}/${o.oneof.name}`)
    .with({ enum: { name: P.string } }, (o) => `${grpcNameBase}/${o.enum.name}`)
    .otherwise(() => '');
}

function mapApiParameters(
  parameters: APIObjectProperty[] | undefined,
  stateEntities: APIStateEntity[],
  schemas: Map<string, APISchema>,
  isPathParameter?: boolean,
) {
  if (!parameters?.length) {
    return undefined;
  }

  return parameters.reduce<Map<string, ParsedObjectProperty>>((acc, parameter) => {
    const converted = apiObjectPropertyToSource(parameter, stateEntities, schemas);

    if (!converted) {
      return acc;
    }

    if (isPathParameter) {
      converted.required = true;
    }

    acc.set(converted.name, converted);

    return acc;
  }, new Map());
}

export function findMethodResponseRootSchema(
  schemas: Map<string, APISchema>,
  response: APIObjectValue,
  packageName: string,
  parentRelatedEntity?: APIStateEntity,
): APIObjectSchema | undefined {
  if (parentRelatedEntity) {
    for (const property of response.properties || []) {
      const found = match(property)
        .with(
          { schema: { object: { ref: { package: packageName, schema: parentRelatedEntity.schemaName } } } },
          (s) => s,
        )
        .otherwise(() => undefined);

      if (found) {
        return found.schema;
      }
    }
  }

  // Check for array first (there should be exactly one in a list method, as per j5client handling)
  let foundArray: APIArraySchema<APIObjectSchema> | undefined;
  for (const property of response.properties || []) {
    const found = match(property)
      .with(
        { schema: { array: { items: { object: { ref: { package: P.not(P.nullish), schema: P.not(P.nullish) } } } } } },
        (s) => s,
      )
      .otherwise(() => undefined);

    if (found) {
      if (foundArray) {
        console.warn(
          `[jdef-ts-generator]: multiple array schemas found in method response ${response.name}, root schema identification may not be accurate`,
        );
      }

      foundArray = found.schema;
    }
  }

  if (foundArray) {
    return foundArray.array.items;
  }

  for (const property of response.properties || []) {
    const found = match(property)
      .with({ schema: { object: { ref: { package: P.not(P.nullish), schema: P.not(P.nullish) } } } }, (s) => s)
      .otherwise(() => undefined);

    if (found && found.schema.object.ref.package === packageName) {
      return found.schema;
    }
  }

  return undefined;
}

export function mapApiAuth(auth: APIMethodAuthType | undefined): ParsedAuthType | undefined {
  return match(auth)
    .with({ '!type': 'cookie' }, () => ({ cookie: {} }))
    .with({ '!type': 'jwtBearer' }, () => ({ jwtBearer: {} }))
    .with({ '!type': 'none' }, () => ({ none: {} }))
    .with({ '!type': 'custom' }, (s) => ({ custom: { passThroughHeaders: s.custom.passThroughHeaders } }))
    .otherwise(() => undefined);
}

export function parseApiSource(source: APISource): ParsedSource {
  const parsed: ParsedSource = {
    metadata: {
      builtAt: new Date(source.api.metadata.builtAt),
      version: source.version,
    },
    packages: [],
    schemas: new Map(),
  };

  const stateEntities = source.api.packages?.flatMap((pkg) => pkg.stateEntities || []);
  const schemas = new Map<string, APISchemaWithPackage>();

  // First, collect, then parse all root-level schemas
  for (const pkg of source.api.packages || []) {
    if (pkg.schemas) {
      for (const schemaName in pkg.schemas) {
        schemas.set(`${pkg.name}.${schemaName}`, { ...pkg.schemas[schemaName], package: pkg });
      }
    }
  }

  for (const [fullGrpcName, schema] of schemas) {
    const { package: pkg, ...rest } = schema;

    const parsedSchema = apiSchemaToSource(rest, stateEntities, schemas, fullGrpcName, pkg);

    if (parsedSchema) {
      parsed.schemas.set(fullGrpcName, parsedSchema as ParsedSchema);
    }
  }

  for (const pkg of source.api.packages || []) {
    const parsedPackage: ParsedPackage = {
      name: pkg.name,
      label: pkg.label,
      introduction: pkg.prose,
      hidden: pkg.hidden,
      services: [],
    };

    function mapListOptions(
      listOptions: APIRequestListOptions | undefined,
      keyReplacementMap: Record<string, string> | undefined,
    ): ParsedMethodListOptions | undefined {
      if (!listOptions) {
        return undefined;
      }

      const options: ParsedMethodListOptions = {};

      if (listOptions.filterableFields) {
        options.filterableFields = listOptions.filterableFields.map((field) => {
          return {
            name: keyReplacementMap?.[field.name] || field.name,
            defaultValues: field.defaultFilters,
          };
        });

        options.defaultFilters = listOptions.filterableFields.reduce<Record<string, string[]>>((acc, curr) => {
          if (curr.defaultFilters) {
            acc[curr.name] = curr.defaultFilters;
          }

          return acc;
        }, {});
      }

      if (listOptions.searchableFields) {
        options.searchableFields = listOptions.searchableFields.map(
          (field) => keyReplacementMap?.[field.name] || field.name,
        );
      }

      if (listOptions.sortableFields) {
        function apiSortDirectionToParsedSortDirection(
          sortDirection: SortingConstraintValue | undefined,
        ): SortDirection | undefined {
          return match(sortDirection)
            .returnType<SortDirection | undefined>()
            .with('ASC', () => 'asc')
            .with('DESC', () => 'desc')
            .otherwise(() => undefined);
        }

        options.sortableFields = listOptions.sortableFields.map((field) => ({
          name: keyReplacementMap?.[field.name] || field.name,
          defaultSort: apiSortDirectionToParsedSortDirection(field.defaultSort),
        }));

        options.defaultSorts = listOptions.sortableFields.reduce<Record<string, SortDirection>>((acc, curr) => {
          const sort = apiSortDirectionToParsedSortDirection(curr.defaultSort);

          if (sort) {
            acc[curr.name] = sort;
          }

          return acc;
        }, {});
      }

      return options;
    }

    function getAPIObjectProperties(
      schema: APISchema,
      schemas: Map<string, APISchema>,
    ): APIObjectProperty[] | undefined {
      return match(schema)
        .with({ object: { ref: P.not(P.nullish) } }, (o) => {
          const refValue = schemas.get(getFullGrpcPathForSchemaRef(o.object.ref));

          if (refValue) {
            return getAPIObjectProperties(refValue, schemas);
          }

          return undefined;
        })
        .with({ object: { properties: P.not(P.nullish) } }, (o) => o.object.properties)
        .with({ oneof: { ref: P.not(P.nullish) } }, (o) => {
          const refValue = schemas.get(getFullGrpcPathForSchemaRef(o.oneof.ref));

          if (refValue) {
            return getAPIObjectProperties(refValue, schemas);
          }

          return undefined;
        })
        .with({ oneof: { properties: P.not(P.nullish) } }, (o) => o.oneof.properties)
        .with({ array: { items: P.not(P.nullish) } }, (a) => getAPIObjectProperties(a.array.items, schemas))
        .otherwise(() => undefined);
    }

    function buildKeyReplacementMap(schema: APIObjectSchema, schemas: Map<string, APISchema>) {
      const replacementMap: Record<string, string> = {};

      const gather = (properties: APIObjectProperty[] | undefined, path: string = '', replacedPath: string = '') => {
        for (const property of properties || []) {
          const subProperties = getAPIObjectProperties(property.schema, schemas);

          const nextPath = `${path}${path ? '.' : ''}${property.name}`;

          if (subProperties) {
            const nextPart = `${replacedPath}${replacedPath ? '.' : ''}${property.name}`;
            gather(subProperties, nextPath, nextPart);
          } else {
            const fullyReplacedPath = `${replacedPath}${replacedPath ? '.' : ''}${property.name}`;

            if (nextPath !== fullyReplacedPath) {
              replacementMap[nextPath] = fullyReplacedPath;
            }
          }
        }
      };

      gather(getAPIObjectProperties(schema, schemas));

      return Object.keys(replacementMap).length ? replacementMap : undefined;
    }

    function mapService(service: APIService, schemas: Map<string, APISchema>, relatedEntity?: APIStateEntity) {
      const parsedService: ParsedService = {
        name: service.name,
        methods: [],
        parentPackage: parsedPackage,
        fullGrpcName: `${parsedPackage.name}.${service.name}`,
      };

      for (const method of service.methods || []) {
        const responseBodyAsObjectSchema = method.responseBody
          ? ({ '!type': 'object', 'object': method.responseBody } as APIObjectSchema)
          : undefined;
        const requestBodyAsObjectSchema = method.request?.body
          ? ({ '!type': 'object', 'object': method.request.body } as APIObjectSchema)
          : undefined;

        const responseBodyValue = match(responseBodyAsObjectSchema)
          .with({ object: { ref: P.not(P.nullish) } }, (o) => {
            const refValue = schemas.get(getFullGrpcPathForSchemaRef(o.object.ref));

            if (refValue && refValue['!type'] === 'object') {
              return refValue.object as APIObjectValue;
            }

            return undefined;
          })
          .with({ object: { name: P.string } }, (o) => o.object)
          .otherwise(() => undefined);

        const rootEntitySchema = responseBodyValue
          ? findMethodResponseRootSchema(schemas, responseBodyValue, parsedPackage.name, relatedEntity)
          : undefined;
        const mappedRelatedEntity = relatedEntity ? mapApiStateEntity(relatedEntity, EntityPart.State) : undefined;
        const mappedPathParameters = mapApiParameters(method.request?.pathParameters, stateEntities, schemas, true);
        const mappedQueryParameters = mapApiParameters(method.request?.queryParameters, stateEntities, schemas);
        const keyReplacementMap = rootEntitySchema ? buildKeyReplacementMap(rootEntitySchema, schemas) : undefined;

        parsedService.methods.push({
          name: method.name,
          fullGrpcName: method.fullGrpcName,
          httpMethod: method.httpMethod.toLowerCase() as HTTPMethod,
          httpPath: method.httpPath,
          rootEntitySchema: rootEntitySchema ? apiSchemaToSource(rootEntitySchema, stateEntities, schemas) : undefined,
          responseBody: responseBodyAsObjectSchema
            ? apiSchemaToSource(
                responseBodyAsObjectSchema,
                stateEntities,
                schemas,
                getApiMethodRequestResponseFullGrpcName(method, responseBodyAsObjectSchema),
                pkg,
              )
            : undefined,
          requestBody: requestBodyAsObjectSchema
            ? apiSchemaToSource(
                requestBodyAsObjectSchema,
                stateEntities,
                schemas,
                getApiMethodRequestResponseFullGrpcName(method, requestBodyAsObjectSchema),
                pkg,
              )
            : undefined,
          pathParameters: mappedPathParameters
            ? addEntityDataToApiPrimaryKeys(mappedRelatedEntity, mappedPathParameters)
            : undefined,
          queryParameters: mappedQueryParameters
            ? addEntityDataToApiPrimaryKeys(mappedRelatedEntity, mappedQueryParameters)
            : undefined,
          listOptions: mapListOptions(method.request?.list, keyReplacementMap),
          relatedEntity: mappedRelatedEntity,
          parentService: parsedService,
          auth: mapApiAuth(method.auth),
        });
      }

      if (parsedService.methods.length) {
        parsedPackage.services.push(parsedService);
      }
    }

    pkg.stateEntities?.forEach((entity) => {
      if (entity.queryService) {
        mapService(entity.queryService, schemas, entity);
      }

      entity.commandServices?.forEach((service) => mapService(service, schemas, entity));
    });

    pkg.services?.forEach((service) => mapService(service, schemas));

    if (parsedPackage.services.length) {
      parsed.packages.push(parsedPackage);
    }
  }

  return parsed;
}

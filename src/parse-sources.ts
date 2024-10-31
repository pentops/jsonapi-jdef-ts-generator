import { match, P } from 'ts-pattern';
import {
  BANG_TYPE_FIELD_NAME,
  ParsedAny,
  ParsedAnyDefinedProperties,
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
import { EntityPart, HTTPMethod, QueryPart, SortingConstraintValue } from './shared-types';
import { getObjectProperties, JSON_SCHEMA_REFERENCE_PREFIX } from './helpers';
import { PackageSummary } from './generated-types';

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
        .with({ ref: P.not(P.nullish) }, (enumWithRef): ParsedRef => buildApiSchemaRef(enumWithRef.ref))
        .with(
          P.not(P.nullish),
          (eWithEnum): ParsedEnum =>
            ({
              enum: {
                fullGrpcName: fullGrpcName!,
                name: eWithEnum.name,
                prefix: eWithEnum.prefix,
                rules: eWithEnum.rules || {},
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
      (b): ParsedBool => ({
        bool: {
          const: b.bool.const,
          rules: b.bool.rules || {},
          listRules: b.bool.listRules || {},
        },
      }),
    )
    .with(
      { '!type': 'integer' },
      (i): ParsedInteger => ({
        integer: {
          format: i.integer.format,
          rules: i.integer.rules || {},
          listRules: i.integer.listRules || {},
        },
      }),
    )
    .with(
      { '!type': 'float' },
      (f): ParsedFloat => ({
        float: {
          format: f.float.format,
          rules: f.float.rules || {},
          listRules: f.float.listRules || {},
        },
      }),
    )
    .with(
      { '!type': 'string' },
      (s): ParsedString => ({
        string: {
          format: s.string.format || '',
          rules: s.string.rules || {},
          listRules: s.string.listRules || {},
        },
      }),
    )
    .with(
      { '!type': 'date' },
      (s): ParsedString =>
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
      (s): ParsedString =>
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
      (s): ParsedString => ({
        string: {
          format: 'decimal',
          rules: s.decimal.rules || {},
        },
      }),
    )
    .with({ '!type': 'oneof' }, (o) =>
      match(o.oneof)
        .with({ ref: P.not(P.nullish) }, (oneOfWithRef): ParsedRef => buildApiSchemaRef(oneOfWithRef.ref))
        .with(
          P.not(P.nullish),
          (oneOf): ParsedOneOf => ({
            oneOf: {
              fullGrpcName: fullGrpcName!,
              description: oneOf.description,
              name: oneOf.name,
              properties: mapObjectProperties(oneOf.properties),
              rules: oneOf.rules || {},
              listRules: oneOf.listRules || {},
              package: apiPackageToSummary(pkg),
            },
          }),
        )
        .otherwise(() => undefined),
    )
    .with({ '!type': 'object' }, (o) =>
      match(o.object)
        .with({ ref: P.not(P.nullish) }, (objectWithRef): ParsedRef => buildApiSchemaRef(objectWithRef.ref))
        .with(P.not(P.nullish), (obj): ParsedObject => {
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
              fullGrpcName: fullGrpcName!,
              name: obj.name,
              description: obj.description,
              additionalProperties: obj.additionalProperties,
              properties: addEntityDataToApiPrimaryKeys(entity, mappedProperties),
              rules: obj.rules || {},
              entity,
              package: apiPackageToSummary(pkg),
            },
          };
        })
        .otherwise(() => undefined),
    )
    .with({ '!type': 'any' }, (a): ParsedAny => {
      const properties: ParsedAnyDefinedProperties = new Map();

      if (a.any.onlyDefined) {
        for (const type of a.any.types) {
          const typeProperties = new Map<string, ParsedObjectProperty>();

          typeProperties.set('!type', {
            name: BANG_TYPE_FIELD_NAME,
            schema: {
              string: {
                format: '',
                rules: {},
                literalValue: type,
              },
            },
          });

          typeProperties.set('value', {
            name: 'value',
            schema: { $ref: `${JSON_SCHEMA_REFERENCE_PREFIX}${type}` },
          });

          properties.set(type, typeProperties);
        }
      }

      return {
        any: {
          onlyDefinedTypes: a.any.onlyDefined ? a.any.types : undefined,
          properties: properties.size ? properties : undefined,
        },
      };
    })
    .with({ '!type': 'map' }, (m): ParsedMap | undefined => {
      const defaultStringSchema: ParsedString = {
        string: {
          format: '',
          rules: {},
        },
      };

      const convertedItemSchema = apiSchemaToSource(m.map.itemSchema, stateEntities, schemas, undefined, pkg);

      if (!convertedItemSchema) {
        return undefined;
      }

      return {
        map: {
          itemSchema: convertedItemSchema,
          keySchema: apiSchemaToSource(m.map.keySchema, stateEntities, schemas, undefined, pkg) || defaultStringSchema,
          rules: m.map.rules || {},
        },
      };
    })
    .with({ '!type': 'array' }, (a): ParsedArray | undefined => {
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
      };
    })
    .with({ '!type': 'bytes' }, (b): ParsedBytes => ({ bytes: { rules: b.bytes.rules } }))
    .with(
      { '!type': 'key' },
      (k): ParsedKey => ({
        key: {
          format: k.key.format,
          primary: match(k.key.entity)
            .with({ primaryKey: true }, () => true)
            .otherwise(() => false),
          foreign: match(k.key.entity)
            .with({ foreignKey: P.not(P.nullish) }, () => true)
            .otherwise(() => false),
          entity: match(k.key.entity)
            .with({ primaryKey: true }, () => undefined) // added by `addEntityDataToApiPrimaryKeys` because there's no ref upwards here
            .with({ foreignKey: P.not(P.nullish) }, (f) => `${f.foreignKey.package}/${f.foreignKey.entity}`)
            .otherwise(() => undefined),
          rules: k.key.rules,
          listRules: k.key.listRules || {},
        },
      }),
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
      // if (foundArray) {
      //   console.warn(
      //     `[jdef-ts-generator]: multiple array schemas found in method response ${response.name}, root schema identification may not be accurate`,
      //   );
      // }

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

    function mapListOptions(listOptions: APIRequestListOptions | undefined): ParsedMethodListOptions | undefined {
      if (!listOptions) {
        return undefined;
      }

      const options: ParsedMethodListOptions = {};

      if (listOptions.filterableFields) {
        options.filterableFields = listOptions.filterableFields.map((field) => {
          return {
            name: field.name,
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
        options.searchableFields = listOptions.searchableFields.map((field) => field.name);
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
          name: field.name,
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

        let rootEntitySchema = responseBodyValue
          ? findMethodResponseRootSchema(responseBodyValue, parsedPackage.name, relatedEntity)
          : undefined;

        if (
          method.methodType?.stateQuery.queryPart === QueryPart.List ||
          method.methodType?.stateQuery.queryPart === QueryPart.Get
        ) {
          const fullStateEntityName = `${pkg.name}/${method.methodType.stateQuery.entityName}`;

          if (fullStateEntityName !== relatedEntity?.fullName) {
            relatedEntity = stateEntities.find((entity) => entity.fullName === fullStateEntityName);

            if (relatedEntity?.schemaName) {
              const potentialRoot = schemas.get(relatedEntity.schemaName);
              if (potentialRoot) {
                rootEntitySchema = potentialRoot as APIObjectSchema;
              }
            }
          }
        } else {
        }

        const mappedRelatedEntity = relatedEntity ? mapApiStateEntity(relatedEntity, EntityPart.State) : undefined;
        const mappedPathParameters = mapApiParameters(method.request?.pathParameters, stateEntities, schemas, true);
        const mappedQueryParameters = mapApiParameters(method.request?.queryParameters, stateEntities, schemas);

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
          listOptions: mapListOptions(method.request?.list),
          relatedEntity: mappedRelatedEntity,
          parentService: parsedService,
          auth: mapApiAuth(method.auth),
          methodType: method.methodType,
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

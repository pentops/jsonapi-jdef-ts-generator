import { match, P } from 'ts-pattern';
import { JDEF, JDEFMethod, JDEFObjectProperty, JDEFParameter, JDEFSchemaWithRef } from './jdef-types';
import {
  ParsedAny,
  ParsedArray,
  ParsedBoolean,
  ParsedBytes,
  ParsedEntity,
  ParsedEnum,
  ParsedFloat,
  ParsedInteger,
  ParsedKey,
  ParsedMap,
  ParsedMethod,
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
  API,
  APIMethod,
  APIObjectProperty,
  APIObjectSchema,
  APIRefValue,
  APIRequestListOptions,
  APIRootSchema,
  APISchema,
  APIService,
  APIStateEntity,
} from './api-types';
import { EntityPart, HTTPMethod } from './shared-types';

export const JSON_SCHEMA_REFERENCE_PREFIX = '#/schemas/';

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

export function jdefSchemaToSource(schema: JDEFSchemaWithRef, schemaName?: string): ParsedSchemaWithRef | undefined {
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
          boolean: {
            const: false,
            example: b.example,
          },
        }) as ParsedBoolean,
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
            itemSchema: jdefSchemaToSource(o.additionalProperties),
            keySchema: o['x-key-property'] ? jdefSchemaToSource(o['x-key-property']) : undefined,
          },
        } as ParsedMap;
      }

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
        },
      } as ParsedObject;
    })
    .with(
      { type: 'array' },
      (a) =>
        ({
          array: {
            example: a.example,
            itemSchema: jdefSchemaToSource(a.items),
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

    const methodsByService: Map<string, ParsedMethod[]> = new Map();

    for (const method of pkg.methods) {
      if (!methodsByService.has(method.grpcServiceName)) {
        methodsByService.set(method.grpcServiceName, []);
      }

      function mapParameters(parameters: JDEFParameter[] | undefined) {
        return parameters?.reduce<ParsedObjectProperty[]>((acc, parameter) => {
          const converted = jdefParameterToSource(parameter);

          if (!converted) {
            return acc;
          }

          return [...acc, converted];
        }, []);
      }

      methodsByService.get(method.grpcServiceName)?.push({
        name: method.grpcMethodName,
        fullGrpcName: method.fullGrpcName,
        httpMethod: method.httpMethod,
        httpPath: method.httpPath,
        responseBody: method.responseBody
          ? jdefSchemaToSource(
              method.responseBody,
              getJdefMethodRequestResponseFullGrpcName(method, method.responseBody),
            )
          : undefined,
        requestBody: method.requestBody
          ? jdefSchemaToSource(method.requestBody, getJdefMethodRequestResponseFullGrpcName(method, method.requestBody))
          : undefined,
        pathParameters: mapParameters(method.pathParameters),
        queryParameters: mapParameters(method.queryParameters),
      });
    }

    for (const serviceName in methodsByService) {
      if (methodsByService.get(serviceName)?.length) {
        parsedPackage.services.push({
          name: serviceName,
          methods: methodsByService.get(serviceName)!,
        });
      }
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
): ParsedObjectProperty | undefined {
  const converted = apiSchemaToSource(property.schema, stateEntities);

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

function buildApiSchemaRef(ref: APIRefValue): ParsedRef {
  return { $ref: `${JSON_SCHEMA_REFERENCE_PREFIX}${ref.package}.${ref.schema}` };
}

export function apiSchemaToSource(
  schema: APISchema,
  stateEntities: APIStateEntity[],
  fullGrpcName?: string,
): ParsedSchemaWithRef | undefined {
  function mapObjectProperties(properties: APIObjectProperty[] | undefined) {
    return (properties || []).reduce<Map<string, ParsedObjectProperty>>((acc, curr) => {
      const converted = apiObjectPropertyToSource(curr, stateEntities);

      if (converted) {
        acc.set(converted.name, converted);
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
      { '!type': 'boolean' },
      (b) =>
        ({
          boolean: {
            rules: b.boolean.rules || {},
          },
        }) as ParsedBoolean,
    )
    .with(
      { '!type': 'integer' },
      (i) =>
        ({
          integer: {
            format: i.integer.format,
            rules: i.integer.rules || {},
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

          return {
            object: {
              fullGrpcName,
              name: obj.name,
              description: obj.description,
              additionalProperties: obj.additionalProperties,
              properties: mapObjectProperties(obj.properties),
              rules: obj.rules,
              entity,
            },
          } as ParsedObject;
        })
        .otherwise(() => undefined),
    )
    .with({ '!type': 'any' }, () => ({ any: {} }) as ParsedAny)
    .with({ '!type': 'map' }, (m) => {
      const convertedItemSchema = apiSchemaToSource(m.map.itemSchema, stateEntities);

      if (!convertedItemSchema) {
        return undefined;
      }

      const convertedKeySchema = apiSchemaToSource(m.map.keySchema, stateEntities) || {
        '!type': 'string',
        'string': {},
      };

      return {
        map: {
          itemSchema: convertedItemSchema,
          keySchema: convertedKeySchema,
        },
      } as ParsedMap;
    })
    .with({ '!type': 'array' }, (a) => {
      const converted = apiSchemaToSource(a.array.items, stateEntities);

      if (!converted) {
        return undefined;
      }

      return {
        array: {
          itemSchema: converted,
          rules: a.array.rules || {},
        },
      } as ParsedArray;
    })
    .with({ '!type': 'bytes' }, () => ({ bytes: {} }) as ParsedBytes)
    .with(
      { '!type': 'key' },
      (k) =>
        ({
          key: {
            format: k.key.format,
            primary: Boolean(k.key.primary),
            entity: k.key.entity,
            rules: k.key.rules,
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

function mapApiParameters(parameters: APIObjectProperty[] | undefined, stateEntities: APIStateEntity[]) {
  if (!parameters?.length) {
    return undefined;
  }

  return parameters.reduce<ParsedObjectProperty[]>((acc, parameter) => {
    const converted = apiObjectPropertyToSource(parameter, stateEntities);

    if (!converted) {
      return acc;
    }

    return [...acc, converted];
  }, []);
}

export function parseApiSource(source: API): ParsedSource {
  const parsed: ParsedSource = {
    metadata: {
      builtAt: new Date(source.metadata.builtAt),
    },
    packages: [],
    schemas: new Map(),
  };

  const stateEntities = source.packages?.flatMap((pkg) => pkg.stateEntities || []);

  // First, parse all root-level schemas
  for (const pkg of source.packages || []) {
    for (const schemaName in pkg.schemas || {}) {
      if (pkg.schemas) {
        const fullGrpcName = `${pkg.name}.${schemaName}`;
        const parsedSchema = apiSchemaToSource(pkg.schemas[schemaName], stateEntities, fullGrpcName);

        if (parsedSchema) {
          parsed.schemas.set(fullGrpcName, parsedSchema as ParsedSchema);
        }
      }
    }
  }

  for (const pkg of source.packages || []) {
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
      }

      if (listOptions.searchableFields) {
        options.searchableFields = listOptions.searchableFields.map((field) => field.name);
      }

      if (listOptions.sortableFields) {
        options.sortableFields = listOptions.sortableFields.map((field) => ({
          name: field.name,
          defaultSort: match(field.defaultSort)
            .returnType<SortDirection | undefined>()
            .with('ASC', () => 'asc')
            .with('DESC', () => 'desc')
            .otherwise(() => undefined),
        }));
      }

      return options;
    }

    function mapService(service: APIService, relatedEntity?: APIStateEntity) {
      const parsedService: ParsedService = {
        name: service.name,
        methods: [],
      };

      for (const method of service.methods || []) {
        const responseBodyAsObjectSchema = method.responseBody
          ? ({ '!type': 'object', 'object': method.responseBody } as APIObjectSchema)
          : undefined;
        const requestBodyAsObjectSchema = method.request?.body
          ? ({ '!type': 'object', 'object': method.request.body } as APIObjectSchema)
          : undefined;

        parsedService.methods.push({
          name: method.name,
          fullGrpcName: method.fullGrpcName,
          httpMethod: method.httpMethod.toLowerCase() as HTTPMethod,
          httpPath: method.httpPath,
          responseBody: responseBodyAsObjectSchema
            ? apiSchemaToSource(
                responseBodyAsObjectSchema,
                stateEntities,
                getApiMethodRequestResponseFullGrpcName(method, responseBodyAsObjectSchema),
              )
            : undefined,
          requestBody: requestBodyAsObjectSchema
            ? apiSchemaToSource(
                requestBodyAsObjectSchema,
                stateEntities,
                getApiMethodRequestResponseFullGrpcName(method, requestBodyAsObjectSchema),
              )
            : undefined,
          pathParameters: mapApiParameters(method.request?.pathParameters, stateEntities),
          queryParameters: mapApiParameters(method.request?.queryParameters, stateEntities),
          listOptions: mapListOptions(method.request?.list),
          relatedEntity: relatedEntity ? mapApiStateEntity(relatedEntity, EntityPart.State) : undefined,
        });
      }

      if (parsedService.methods.length) {
        parsedPackage.services.push(parsedService);
      }
    }

    pkg.stateEntities?.forEach((entity) => {
      if (entity.queryService) {
        mapService(entity.queryService, entity);
      }

      entity.commandServices?.forEach((service) => mapService(service, entity));
    });

    pkg.services?.forEach((service) => mapService(service));

    if (parsedPackage.services.length) {
      parsed.packages.push(parsedPackage);
    }
  }

  return parsed;
}

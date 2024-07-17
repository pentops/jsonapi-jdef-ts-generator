import { match, P } from 'ts-pattern';
import { JDEF, JDEFMethod, JDEFObjectProperty, JDEFParameter, JDEFSchemaWithRef } from './jdef-types';
import {
  ParsedAny,
  ParsedArray,
  ParsedBoolean,
  ParsedEnum,
  ParsedFloat,
  ParsedInteger,
  ParsedMap,
  ParsedMethod,
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
} from './parsed-types';
import { constantCase } from 'change-case';
import { API, APIMethod, APIObjectProperty, APISchemaWithRef } from './api-types';
import { HTTPMethod } from './shared-types';

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
      // console.warn(`[jdef-ts-generator]: unsupported schema type while parsing jdef source: ${schema}`);
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
  const parsed: ParsedSource = {
    metadata: {
      builtAt: new Date(source.metadata.built_at.seconds * 1000 + source.metadata.built_at.nanos / 1_000_000),
    },
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

    const methodsByService: Record<string, ParsedMethod[]> = {};

    for (const method of pkg.methods) {
      if (!methodsByService[method.grpcServiceName]) {
        methodsByService[method.grpcServiceName] = [];
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

      methodsByService[method.grpcServiceName].push({
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
      if (methodsByService[serviceName].length) {
        parsedPackage.services.push({
          name: serviceName,
          methods: methodsByService[serviceName],
        });
      }
    }

    if (parsedPackage.services.length) {
      parsed.packages.push(parsedPackage);
    }
  }

  return parsed;
}

export function apiObjectPropertyToSource(property: APIObjectProperty): ParsedObjectProperty | undefined {
  const converted = apiSchemaToSource(property.schema);

  if (!converted) {
    return undefined;
  }

  return {
    ...property,
    schema: converted,
  };
}

export function apiSchemaToSource(schema: APISchemaWithRef, fullGrpcName?: string): ParsedSchemaWithRef | undefined {
  function mapObjectProperties(properties: APIObjectProperty[] | undefined) {
    return (properties || []).reduce<Map<string, ParsedObjectProperty>>((acc, curr) => {
      const converted = apiObjectPropertyToSource(curr);

      if (converted) {
        acc.set(converted.name, converted);
      }

      return acc;
    }, new Map());
  }

  return match(schema)
    .with(
      { '!type': 'enum' },
      (e) =>
        ({
          enum: {
            fullGrpcName,
            name: e.enum.name,
            prefix: e.enum.prefix,
            options: e.enum.options.map((option) => ({
              name: option.name,
              description: option.description,
              number: option.number,
            })),
          },
        }) as ParsedEnum,
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
      { '!type': 'ref' },
      (r) => ({ $ref: `${JSON_SCHEMA_REFERENCE_PREFIX}${r.ref.package}.${r.ref.schema}` }) as ParsedRef,
    )
    .with(
      { '!type': 'oneof' },
      (o) =>
        ({
          oneOf: {
            fullGrpcName,
            name: o.oneof.name,
            properties: mapObjectProperties(o.oneof.properties),
            rules: {},
          },
        }) as ParsedOneOf,
    )
    .with(
      { '!type': 'object' },
      (o) =>
        ({
          object: {
            fullGrpcName,
            name: o.object.name,
            properties: mapObjectProperties(o.object.properties),
            rules: {},
          },
        }) as ParsedObject,
    )
    .with({ '!type': 'any' }, () => ({ any: {} }) as ParsedAny)
    .with({ '!type': 'map' }, (m) => {
      const converted = apiSchemaToSource(m.map.itemSchema);

      if (!converted) {
        return undefined;
      }

      return {
        map: {
          itemSchema: converted,
          keySchema: apiSchemaToSource({ '!type': 'string', 'string': {} }) as ParsedString,
        },
      } as ParsedMap;
    })
    .with({ '!type': 'array' }, (a) => {
      const converted = apiSchemaToSource(a.array.items);

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
    .otherwise(() => {
      console.warn(`[jdef-ts-generator]: unsupported schema type while parsing api source: ${schema}`);
      return undefined;
    });
}

function getApiMethodRequestResponseFullGrpcName(method: APIMethod, requestOrResponse: APISchemaWithRef): string {
  const grpcNameBase = method.fullGrpcName.split('/').slice(0, -1).join('/');

  return match(requestOrResponse)
    .with({ object: { name: P.string } }, (o) => `${grpcNameBase}/${o.object.name}`)
    .with({ oneof: { name: P.string } }, (o) => `${grpcNameBase}/${o.oneof.name}`)
    .with({ enum: { name: P.string } }, (o) => `${grpcNameBase}/${o.enum.name}`)
    .otherwise(() => '');
}

export function parseApiSource(source: API): ParsedSource {
  const parsed: ParsedSource = {
    metadata: {
      builtAt: new Date(source.metadata.builtAt),
    },
    packages: [],
    schemas: new Map(),
  };

  for (const pkg of source.packages || []) {
    for (const schemaName in pkg.schemas || {}) {
      if (pkg.schemas) {
        const parsedSchema = apiSchemaToSource(pkg.schemas[schemaName], schemaName);

        if (parsedSchema) {
          parsed.schemas.set(schemaName, parsedSchema as ParsedSchema);
        }
      }
    }

    const parsedPackage: ParsedPackage = {
      name: pkg.name,
      label: pkg.label,
      introduction: pkg.introduction,
      hidden: pkg.hidden,
      services: [],
    };

    for (const service of pkg.services || []) {
      const parsedService: ParsedService = {
        name: service.name,
        methods: [],
      };

      for (const method of service.methods || []) {
        const pathParameterNames = method.httpPath
          ?.split('/')
          .filter((part) => part.startsWith(':'))
          .map((part) => part.slice(1));
        const req = method.requestBody
          ? apiSchemaToSource(method.requestBody, getApiMethodRequestResponseFullGrpcName(method, method.requestBody))
          : undefined;
        const pathParameters: ParsedObjectProperty[] = [];
        const queryParameters: ParsedObjectProperty[] = [];

        if (req && Object.hasOwn(req, 'object')) {
          const reqObject = req as ParsedObject;

          // TODO: refactor this with j5 changes that handle splitting here
          for (const [propertyName, property] of reqObject.object.properties) {
            if (pathParameterNames?.includes(propertyName)) {
              pathParameters.push(property);
              reqObject.object.properties.delete(propertyName);
            } else if (method.httpMethod === 'GET') {
              queryParameters.push(property);
              reqObject.object.properties.delete(propertyName);
            }
          }
        }

        const hasRequestBody = match(req)
          .with({ object: P.not(P.nullish) }, (o) => Boolean(o.object.properties.size > 0))
          .with({ oneOf: P.not(P.nullish) }, (o) => Boolean(o.oneOf.properties.size > 0))
          .otherwise(() => false);

        parsedService.methods.push({
          name: method.name,
          fullGrpcName: method.fullGrpcName,
          httpMethod: method.httpMethod.toLowerCase() as HTTPMethod,
          httpPath: method.httpPath,
          responseBody: method.responseBody
            ? apiSchemaToSource(
                method.responseBody,
                getApiMethodRequestResponseFullGrpcName(method, method.responseBody),
              )
            : undefined,
          requestBody: hasRequestBody ? req : undefined,
          pathParameters: pathParameters.length ? pathParameters : undefined,
          queryParameters: queryParameters.length ? queryParameters : undefined,
        });
      }

      if (parsedService.methods.length) {
        parsedPackage.services.push(parsedService);
      }
    }

    if (parsedPackage.services.length) {
      parsed.packages.push(parsedPackage);
    }
  }

  return parsed;
}

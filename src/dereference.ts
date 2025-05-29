import { match, P } from 'ts-pattern';
import type {
  DereferencedParsedSchema,
  ParsedMethod,
  ParsedObjectProperty,
  ParsedPackage,
  ParsedPolymorphProperties,
  ParsedSchema,
  ParsedSchemaWithRef,
  ParsedService,
  ParsedSource,
} from './parsed-types';
import { cleanRefName } from './helpers';

export function dereferenceObjectProperties(
  properties: Map<string, ParsedObjectProperty>,
  schemas: Map<string, ParsedSchema>,
  visited: Map<string, DereferencedParsedSchema> = new Map(),
) {
  const dereferencedProperties = new Map<string, ParsedObjectProperty<DereferencedParsedSchema>>();

  for (const [key, property] of properties) {
    const dereferencedSchema = dereferenceSchema(property.schema, schemas, visited || new Map());

    if (dereferencedSchema) {
      dereferencedProperties.set(key, {
        ...property,
        schema: dereferencedSchema,
      });
    }
  }

  return dereferencedProperties;
}

export function dereferencePolymorphProperties(
  properties: ParsedPolymorphProperties,
  schemas: Map<string, ParsedSchema>,
  visited: Map<string, DereferencedParsedSchema> = new Map(),
) {
  const dereferencedProperties: ParsedPolymorphProperties<DereferencedParsedSchema> = new Map();

  for (const [k, v] of properties) {
    dereferencedProperties.set(k, dereferenceObjectProperties(v, schemas, visited));
  }

  return dereferencedProperties;
}

export function dereferenceSchema(
  schema: ParsedSchemaWithRef,
  schemas: Map<string, ParsedSchema>,
  visited: Map<string, DereferencedParsedSchema> = new Map(),
): DereferencedParsedSchema | undefined {
  return match(schema)
    .returnType<DereferencedParsedSchema | undefined>()
    .with({ $ref: P.not(P.nullish) }, (s) => {
      const fullGrpcName = cleanRefName(s);
      const refSchema = schemas.get(fullGrpcName);

      if (!refSchema) {
        console.error(`[jdef-ts-generator]: schema for ref ${fullGrpcName} not found, dereferencing failed`);
        return undefined;
      }

      if (visited.has(fullGrpcName)) {
        return visited.get(fullGrpcName) as DereferencedParsedSchema;
      }

      // Mark schema as being processed to avoid infinite recursion
      visited.set(fullGrpcName, refSchema as DereferencedParsedSchema);

      const dereferenced = dereferenceSchema(refSchema, schemas, visited);

      // Once fully dereferenced, update the visited map with the dereferenced result
      if (dereferenced) {
        visited?.set(fullGrpcName, dereferenced);
      }

      return dereferenced;
    })
    .with({ array: P.not(P.nullish) }, (s) => {
      const dereferencedItemSchema = dereferenceSchema(s.array.itemSchema, schemas, visited);

      if (!dereferencedItemSchema) {
        return undefined;
      }

      return {
        ...s,
        array: {
          ...s.array,
          itemSchema: dereferencedItemSchema,
        },
      };
    })
    .with({ map: P.not(P.nullish) }, (s) => ({
      ...s,
      map: {
        ...s.map,
        keySchema: dereferenceSchema(s.map.keySchema, schemas, visited)!,
        itemSchema: dereferenceSchema(s.map.itemSchema, schemas, visited)!,
      },
    }))
    .with({ oneOf: P.not(P.nullish) }, (s) => ({
      ...s,
      oneOf: {
        ...s.oneOf,
        properties: dereferenceObjectProperties(s.oneOf.properties, schemas, visited || new Map()),
      },
    }))
    .with({ object: P.not(P.nullish) }, (s) => ({
      ...s,
      object: {
        ...s.object,
        properties: dereferenceObjectProperties(s.object.properties, schemas, visited || new Map()),
      },
    }))
    .with({ polymorph: { properties: P.not(P.nullish) } }, (s) => ({
      ...s,
      polymorph: {
        ...s.polymorph,
        properties: dereferencePolymorphProperties(s.polymorph.properties, schemas, visited || new Map()),
      },
    }))
    .otherwise((s) => s as DereferencedParsedSchema);
}

export function dereferenceMethod(
  method: ParsedMethod,
  dereferencedSchemas: Map<string, DereferencedParsedSchema>,
  visitedPackages = new Map<string, ParsedPackage<DereferencedParsedSchema>>(),
  visitedServices = new Map<string, ParsedService<DereferencedParsedSchema>>(),
  visited = new Map<string, ParsedMethod<DereferencedParsedSchema>>(),
): ParsedMethod<DereferencedParsedSchema> {
  if (visited.has(method.fullGrpcName)) {
    return visited.get(method.fullGrpcName) as ParsedMethod<DereferencedParsedSchema>;
  }

  // Mark method as being processed to avoid infinite recursion
  visited.set(method.fullGrpcName, method as ParsedMethod<DereferencedParsedSchema>);

  const visitedSchemas = new Map<string, DereferencedParsedSchema>();

  const dereferenced: ParsedMethod<DereferencedParsedSchema> = {
    ...method,
    requestBody: method.requestBody
      ? dereferenceSchema(method.requestBody, dereferencedSchemas, visitedSchemas)
      : undefined,
    responseBody: method.responseBody
      ? dereferenceSchema(method.responseBody, dereferencedSchemas, visitedSchemas)
      : undefined,
    pathParameters: method.pathParameters
      ? dereferenceObjectProperties(method.pathParameters, dereferencedSchemas, visitedSchemas)
      : undefined,
    queryParameters: method.queryParameters
      ? dereferenceObjectProperties(method.queryParameters, dereferencedSchemas, visitedSchemas)
      : undefined,
    rootEntitySchema: method.rootEntitySchema
      ? dereferenceSchema(method.rootEntitySchema, dereferencedSchemas, visitedSchemas)
      : undefined,
    parentService: dereferenceService(method.parentService, dereferencedSchemas, visitedPackages, visitedServices),
  };

  visited.set(method.fullGrpcName, dereferenced);

  return dereferenced;
}

export function dereferenceService(
  service: ParsedService,
  dereferencedSchemas: Map<string, DereferencedParsedSchema>,
  visitedPackages = new Map<string, ParsedPackage<DereferencedParsedSchema>>(),
  visited = new Map<string, ParsedService<DereferencedParsedSchema>>(),
): ParsedService<DereferencedParsedSchema> {
  if (visited.has(service.name)) {
    return visited.get(service.name) as ParsedService<DereferencedParsedSchema>;
  }

  const visitedMethods = new Map<string, ParsedMethod<DereferencedParsedSchema>>();

  // Mark service as being processed to avoid infinite recursion
  visited.set(service.name, service as ParsedService<DereferencedParsedSchema>);

  const dereferenced: ParsedService<DereferencedParsedSchema> = {
    ...service,
    methods: service.methods.map((method) =>
      dereferenceMethod(method, dereferencedSchemas, visitedPackages, visited, visitedMethods),
    ),
    parentPackage: dereferencePackage(service.parentPackage, dereferencedSchemas, visitedPackages),
  };

  visited.set(service.name, dereferenced);

  return dereferenced;
}

export function dereferencePackage(
  pkg: ParsedPackage,
  dereferencedSchemas: Map<string, DereferencedParsedSchema>,
  visited = new Map<string, ParsedPackage<DereferencedParsedSchema>>(),
): ParsedPackage<DereferencedParsedSchema> {
  if (visited.has(pkg.name)) {
    return visited.get(pkg.name) as ParsedPackage<DereferencedParsedSchema>;
  }

  // Mark package as being processed to avoid infinite recursion
  visited.set(pkg.name, pkg as ParsedPackage<DereferencedParsedSchema>);

  const visitedServices = new Map<string, ParsedService<DereferencedParsedSchema>>();

  // Once fully dereferenced, update the visited map with the dereferenced result
  const dereferenced: ParsedPackage<DereferencedParsedSchema> = {
    ...pkg,
    services: pkg.services.map((service) => dereferenceService(service, dereferencedSchemas, visited, visitedServices)),
  };

  visited.set(pkg.name, dereferenced);

  return dereferenced;
}

export function dereferenceSource(
  source: ParsedSource,
): ParsedSource<DereferencedParsedSchema, DereferencedParsedSchema> {
  const dereferencedSchemas = new Map<string, DereferencedParsedSchema>();

  const visitedSchemas = new Map<string, DereferencedParsedSchema>();
  for (const [schemaName, schema] of source.schemas) {
    const dereferencedSchema = dereferenceSchema(schema, source.schemas, visitedSchemas);
    if (dereferencedSchema) {
      dereferencedSchemas.set(schemaName, dereferencedSchema);
    }
  }

  const visitedPackages = new Map<string, ParsedPackage<DereferencedParsedSchema>>();

  return {
    ...source,
    schemas: dereferencedSchemas,
    packages: source.packages.map((pkg) => dereferencePackage(pkg, dereferencedSchemas, visitedPackages)),
  };
}

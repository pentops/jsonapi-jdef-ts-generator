import { match, P } from 'ts-pattern';
import type { GenericOverride, GenericOverrideMap } from './config-types';
import type { ParsedObject, ParsedObjectProperty, ParsedRef, ParsedSchema, ParsedSchemaWithRef } from './parsed-types';
import type { GeneratedSchema, GeneratedSchemaWithNode, PackageSummary } from './generated-types';

export const JSON_SCHEMA_REFERENCE_PREFIX = '#/schemas/';

export function cleanRefName(ref: ParsedRef) {
  return ref.$ref.replace(JSON_SCHEMA_REFERENCE_PREFIX, '');
}

export function findSchemaForEntityName(
  entityName: string,
  schemas: Map<string, ParsedSchema>,
): ParsedObject | undefined {
  return Array.from(schemas.values()).find((schema) => {
    if ('object' in schema && schema.object.entity?.stateEntityFullName === entityName) {
      return true;
    }
  }) as ParsedObject | undefined;
}

export function findSchemaProperties(
  schema: ParsedSchemaWithRef,
  generatedSchemas: Map<string, GeneratedSchemaWithNode>,
): Map<string, ParsedObjectProperty> {
  return match(schema)
    .with({ $ref: P.not(P.nullish) }, (r) => {
      const refValue = generatedSchemas.get(cleanRefName(r));
      return refValue
        ? findSchemaProperties(refValue.rawSchema, generatedSchemas)
        : new Map<string, ParsedObjectProperty>();
    })
    .with({ object: { properties: P.not(P.nullish) } }, (r) => r.object.properties)
    .with({ oneOf: { properties: P.not(P.nullish) } }, (r) => r.oneOf.properties)
    .with({ array: { itemSchema: P.not(P.nullish) } }, (r) =>
      findSchemaProperties(r.array.itemSchema, generatedSchemas),
    )
    .otherwise(() => new Map<string, ParsedObjectProperty>());
}

export function getSchemaName(schema: ParsedSchemaWithRef | undefined, schemas: Map<string, ParsedSchema>): string {
  return match(schema)
    .with({ object: P.not(P.nullish) }, (s) => s.object.name)
    .with({ enum: P.not(P.nullish) }, (s) => s.enum.name)
    .with({ oneOf: P.not(P.nullish) }, (s) => s.oneOf.name)
    .with({ $ref: P.not(P.nullish) }, (s) => getSchemaName(schemas.get(cleanRefName(s)), schemas))
    .with({ array: P.not(P.nullish) }, (s) => getSchemaName(s.array.itemSchema, schemas))
    .otherwise(() => '');
}

export function getFullGRPCName(schema: ParsedSchemaWithRef | undefined): string {
  return match(schema)
    .with({ object: P.not(P.nullish) }, (s) => s.object.fullGrpcName)
    .with({ enum: P.not(P.nullish) }, (s) => s.enum.fullGrpcName)
    .with({ oneOf: P.not(P.nullish) }, (s) => s.oneOf.fullGrpcName)
    .with({ array: P.not(P.nullish) }, (s) => getFullGRPCName(s.array.itemSchema))
    .with({ $ref: P.not(P.nullish) }, (s) => cleanRefName(s))
    .otherwise(() => '');
}

export function getPackageSummary(schema: ParsedSchemaWithRef | undefined): PackageSummary | undefined {
  return match(schema)
    .with({ object: P.not(P.nullish) }, (s) => s.object.package)
    .with({ enum: P.not(P.nullish) }, (s) => s.enum.package)
    .with({ oneOf: P.not(P.nullish) }, (s) => s.oneOf.package)
    .with({ array: P.not(P.nullish) }, (s) => getPackageSummary(s.array.itemSchema))
    .otherwise(() => undefined);
}

export function getGeneratedSchemasForPackage(
  fullGrpcPackageName: string,
  generatedSchemas: Map<string, GeneratedSchema>,
) {
  return Array.from(generatedSchemas.values()).filter(
    (schema) => schema.parentPackage?.package === fullGrpcPackageName,
  );
}

export function getObjectProperties(
  schema: ParsedSchemaWithRef | undefined,
  schemas: Map<string, ParsedSchema> = new Map(),
): Map<string, ParsedObjectProperty> | undefined {
  return match(schema)
    .with({ object: P.not(P.nullish) }, (s) => s.object.properties)
    .with({ oneOf: P.not(P.nullish) }, (s) => s.oneOf.properties)
    .with({ $ref: P.not(P.nullish) }, (s) => getObjectProperties(schemas.get(cleanRefName(s)), schemas))
    .with({ array: P.not(P.nullish) }, (s) => getObjectProperties(s.array.itemSchema, schemas))
    .with({ map: P.not(P.nullish) }, (s) => {
      const itemMap = getObjectProperties(s.map.itemSchema, schemas);
      const keyMap = getObjectProperties(s.map.keySchema, schemas);

      if (itemMap || keyMap) {
        return new Map([...(itemMap || new Map()), ...(keyMap || new Map())]);
      }

      return undefined;
    })
    .otherwise(() => undefined);
}

export function isCharacterSafeForName(char: string) {
  return char.match(/\p{Letter}|[0-9]|\$|_/u);
}

export function isKeyword(rawName: string) {
  try {
    new Function('var ' + rawName + ';');
    return false;
  } catch {
    return true;
  }
}

export function isKeyNameValid(rawName: string) {
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

export function getValidKeyName(rawName: string) {
  return isKeyNameValid(rawName) ? rawName : `'${rawName}'`;
}

export function generatedSchemaMapToParsedSchemaMap(
  generatedSchemas: Map<string, GeneratedSchema>,
): Map<string, ParsedSchema> {
  const parsedSchemas = new Map<string, ParsedSchema>();

  for (const [key, value] of generatedSchemas) {
    parsedSchemas.set(key, value.rawSchema);
  }

  return parsedSchemas;
}

export function getPropertyByPath(
  path: string,
  schema: ParsedSchemaWithRef,
  schemas: Map<string, ParsedSchema>,
): ParsedSchema | undefined {
  const parts = path.split('.');
  let currentPart = parts.shift();
  let currentSchema = schema;

  while (currentPart) {
    const properties = getObjectProperties(currentSchema, schemas);

    if (!properties) {
      return undefined;
    }

    if (!properties.has(currentPart)) {
      return undefined;
    }

    currentSchema = properties.get(currentPart)!.schema;
    currentPart = parts.shift();
  }

  return match(currentSchema)
    .with({ $ref: P.not(P.nullish) }, (s) => schemas.get(cleanRefName(s)))
    .otherwise(() => currentSchema as ParsedSchema);
}

export function getAllGenericsForChildren(generics: GenericOverrideMap | undefined): GenericOverride[] {
  const overrides = new Set<GenericOverride>();
  const queue = generics ? Array.from(generics || []) : [];
  const visited = new Set<GenericOverrideMap>();

  while (queue.length) {
    const [_, prospect] = queue.shift()!;

    if (prospect instanceof Map) {
      if (!visited.has(prospect)) {
        visited.add(prospect);
        queue.push(...Array.from(prospect));
      }
    } else {
      overrides.add(prospect);
    }
  }

  return Array.from(overrides);
}

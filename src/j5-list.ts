import ts from 'typescript';
import type { GenericOverride, GenericOverrideMap, GenericValueDeterminer } from './config';
import { getAllGenericsForChildren } from './helpers';

// j5.list.v1 gRPC names for building generic, type-safe request objects
export const J5_LIST_V1_SEARCH_GRPC_NAME = 'j5.list.v1.Search';
export const J5_LIST_V1_SORT_GRPC_NAME = 'j5.list.v1.Sort';
export const J5_LIST_V1_FIELD_GRPC_NAME = 'j5.list.v1.Field';

export const J5_LIST_V1_FILTER_FIELD_GENERIC_OVERRIDE: GenericOverride = {
  name: 'TFilterField',
  extends: 'string',
  default: 'never',
} as const;

export const J5_LIST_V1_SEARCH_FIELD_GENERIC_OVERRIDE: GenericOverride = {
  name: 'TSearchField',
  extends: 'string',
  default: 'never',
} as const;

export const J5_LIST_V1_SORT_FIELD_GENERIC_OVERRIDE: GenericOverride = {
  name: 'TSortField',
  extends: 'string',
  default: 'never',
} as const;

export const defaultJ5ListGenericValueDeterminer: GenericValueDeterminer = (
  schema,
  getGenericsForSchema,
  parentMethod,
) => {
  const genericsForSchema = getAllGenericsForChildren(getGenericsForSchema(schema));

  if (!parentMethod) {
    return genericsForSchema;
  }

  if (genericsForSchema?.length && parentMethod.list) {
    return genericsForSchema.map((generic) => {
      switch (generic) {
        case J5_LIST_V1_FILTER_FIELD_GENERIC_OVERRIDE:
          const filterFieldEnumName = parentMethod.list?.get('filterableFields')?.generatedName;

          return {
            ...generic,
            value: filterFieldEnumName ? ts.factory.createTypeReferenceNode(filterFieldEnumName) : null,
          };
        case J5_LIST_V1_SEARCH_FIELD_GENERIC_OVERRIDE:
          const searchFieldEnumName = parentMethod.list?.get('searchableFields')?.generatedName;

          return {
            ...generic,
            value: searchFieldEnumName ? ts.factory.createTypeReferenceNode(searchFieldEnumName) : null,
          };
        case J5_LIST_V1_SORT_FIELD_GENERIC_OVERRIDE:
          const sortFieldEnumName = parentMethod.list?.get('sortableFields')?.generatedName;

          return {
            ...generic,
            value: sortFieldEnumName ? ts.factory.createTypeReferenceNode(sortFieldEnumName) : null,
          };
        default:
          return generic;
      }
    });
  }

  return genericsForSchema;
};

export const DEFAULT_J5_LIST_GENERIC_OVERRIDES: Map<string, GenericOverrideMap> = new Map([
  [J5_LIST_V1_FIELD_GRPC_NAME, new Map([['name', J5_LIST_V1_FILTER_FIELD_GENERIC_OVERRIDE]])],
  [J5_LIST_V1_SEARCH_GRPC_NAME, new Map([['field', J5_LIST_V1_SEARCH_FIELD_GENERIC_OVERRIDE]])],
  [J5_LIST_V1_SORT_GRPC_NAME, new Map([['field', J5_LIST_V1_SORT_FIELD_GENERIC_OVERRIDE]])],
]);

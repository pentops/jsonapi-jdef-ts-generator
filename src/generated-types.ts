import type { InterfaceDeclaration, TypeNode, TypeAliasDeclaration, EnumDeclaration } from 'typescript';
import { ParsedEnum, ParsedMethod, ParsedObject, ParsedOneOf, ParsedSchema, SortDirection } from './parsed-types';

export interface PackageSummary {
  package: string;
  label: string | undefined;
}

export type GeneratedSchemaDetails<T> = T extends ParsedEnum
  ? { generatedValueNames: Map<string, string> }
  : T extends ParsedOneOf
    ? { derivedOneOfTypeEnumName: string }
    : {};

export interface BaseGeneratedSchema<TSchema extends ParsedSchema = ParsedSchema> {
  generatedName: string;
  rawSchema: TSchema;
  parentPackage?: PackageSummary;
}

export type GeneratedSchema<TSchema extends ParsedSchema = ParsedSchema> = BaseGeneratedSchema<TSchema> &
  GeneratedSchemaDetails<TSchema>;

export interface BuiltMethodListSchema {
  defaultFilters?: Record<string, string[]>;
  defaultSorts?: Record<string, SortDirection>;
  filterableFields?: GeneratedSchema<ParsedEnum>;
  searchableFields?: GeneratedSchema<ParsedEnum>;
  sortableFields?: GeneratedSchema<ParsedEnum>;
}

export interface BuiltMethodSchema {
  rawMethod: ParsedMethod;
  mergedRequestSchema?: GeneratedSchema<ParsedObject>;
  requestBodySchema?: GeneratedSchema<ParsedObject>;
  pathParametersSchema?: GeneratedSchema<ParsedObject>;
  queryParametersSchema?: GeneratedSchema<ParsedObject>;
  responseBodySchema?: GeneratedSchema<ParsedObject>;
  list?: BuiltMethodListSchema;
  relatedEntity?: GeneratedSchema<ParsedObject>;
  rootEntitySchema?: GeneratedSchema<ParsedObject>;
  parentPackage: PackageSummary;
}

export interface GeneratedClientFunction {
  generatedName: string;
  method: BuiltMethodSchema;
}

export type GeneratedSchemaWithNode<TSchema extends ParsedSchema = ParsedSchema> = {
  fullGrpcName?: string;
  node: TypeNode | InterfaceDeclaration | TypeAliasDeclaration | EnumDeclaration;
} & GeneratedSchema<TSchema>;

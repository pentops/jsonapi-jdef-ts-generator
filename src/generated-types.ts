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

export type GeneratedSchemaWithNode<TSchema extends ParsedSchema = ParsedSchema> = {
  fullGrpcName?: string;
  node: TypeNode | InterfaceDeclaration | TypeAliasDeclaration | EnumDeclaration;
} & GeneratedSchema<TSchema>;

export interface BuiltMethodListSchema<
  TGeneratedEnum extends GeneratedSchema<ParsedEnum> = GeneratedSchema<ParsedEnum>,
> {
  defaultFilters?: Record<string, string[]>;
  defaultSorts?: Record<string, SortDirection>;
  filterableFields?: TGeneratedEnum;
  searchableFields?: TGeneratedEnum;
  sortableFields?: TGeneratedEnum;
}

export interface BuiltMethodSchema<
  TGeneratedObject extends GeneratedSchema<ParsedObject> = GeneratedSchema<ParsedObject>,
  TGeneratedEnum extends GeneratedSchema<ParsedEnum> = GeneratedSchema<ParsedEnum>,
> {
  rawMethod: ParsedMethod;
  mergedRequestSchema?: TGeneratedObject;
  requestBodySchema?: TGeneratedObject;
  pathParametersSchema?: TGeneratedObject;
  queryParametersSchema?: TGeneratedObject;
  responseBodySchema?: TGeneratedObject;
  list?: BuiltMethodListSchema<TGeneratedEnum>;
  relatedEntity?: TGeneratedObject;
  rootEntitySchema?: TGeneratedObject;
  parentPackage: PackageSummary;
}

export interface GeneratedClientFunction<
  TGeneratedObject extends GeneratedSchema<ParsedObject> = GeneratedSchema<ParsedObject>,
  TGeneratedEnum extends GeneratedSchema<ParsedEnum> = GeneratedSchema<ParsedEnum>,
> {
  generatedName: string;
  method: BuiltMethodSchema<TGeneratedObject, TGeneratedEnum>;
}

export type GeneratedClientFunctionWithNodes = GeneratedClientFunction<
  GeneratedSchemaWithNode<ParsedObject>,
  GeneratedSchemaWithNode<ParsedEnum>
>;

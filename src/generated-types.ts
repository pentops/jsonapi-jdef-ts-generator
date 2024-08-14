import type { InterfaceDeclaration, TypeNode, TypeAliasDeclaration, EnumDeclaration } from 'typescript';
import type { ParsedEnum, ParsedMethod, ParsedObject, ParsedSchema } from './parsed-types';

export interface PackageSummary {
  package: string;
  label: string | undefined;
}

export interface GeneratedSchema<TSchema extends ParsedSchema = ParsedSchema> {
  generatedName: string;
  rawSchema: TSchema;
  parentPackage?: PackageSummary;
}

export interface BuiltMethodListSchema {
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

export interface GeneratedSchemaWithNode<TSchema extends ParsedSchema = ParsedSchema> extends GeneratedSchema<TSchema> {
  fullGrpcName?: string;
  node: TypeNode | InterfaceDeclaration | TypeAliasDeclaration | EnumDeclaration;
}

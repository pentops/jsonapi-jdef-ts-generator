import {
  ArrayRules,
  EntityObjectSchema,
  EnumValueDescription,
  HTTPMethod,
  IntegerRules,
  NumberRules,
  ObjectRules,
  StateEntityEvent,
  StringRules,
} from './shared-types';

export interface ParsedMetadata {
  builtAt: Date | null;
}

export interface ParsedEnum {
  enum: {
    fullGrpcName: string;
    name: string;
    options: EnumValueDescription[];
    prefix: string;
    example?: any;
  };
}

export interface ParsedBoolean {
  boolean: {
    const?: boolean;
    example?: any;
  };
}

export interface ParsedInteger {
  integer: {
    format?: string;
    rules: IntegerRules;
    example?: any;
  };
}

export interface ParsedFloat {
  float: {
    format?: string;
    rules: NumberRules;
    example?: any;
  };
}

export interface ParsedString {
  string: {
    format: string;
    rules: StringRules;
    example?: any;
  };
}

export interface ParsedRef {
  $ref: string;
}

export interface ParsedAny {
  any: {
    example?: any;
  };
}

export interface ParsedMap {
  map: {
    itemSchema: ParsedSchemaWithRef;
    keySchema: ParsedSchemaWithRef;
    example?: any;
  };
}

export interface ParsedObjectProperty<TSchemaWithRef extends ParsedSchemaWithRef = ParsedSchemaWithRef> {
  description?: string;
  example?: any;
  name: string;
  readOnly?: boolean;
  required?: boolean;
  schema: TSchemaWithRef;
  writeOnly?: boolean;
}

export interface ParsedEntity extends EntityObjectSchema {
  schemaFullGrpcName?: string;
  stateEntityFullName?: string;
  primaryKeys?: string[];
  events?: StateEntityEvent[];
  queryMethods?: string[];
  commandMethods?: string[];
}

export interface ParsedObject<TSchemaWithRef extends ParsedSchemaWithRef = ParsedSchemaWithRef> {
  object: {
    description?: string;
    fullGrpcName: string;
    name: string;
    entity?: ParsedEntity;
    properties: Map<string, ParsedObjectProperty<TSchemaWithRef>>;
    rules: ObjectRules;
    example?: any;
    additionalProperties?: boolean;
  };
}

export interface ParsedOneOf {
  oneOf: {
    description?: string;
    fullGrpcName: string;
    name: string;
    properties: Map<string, ParsedObjectProperty>;
    example?: any;
  };
}

export interface ParsedArray {
  array: {
    itemSchema: ParsedSchemaWithRef;
    rules: ArrayRules;
    example: any;
  };
}

export interface ParsedBytes {
  bytes: {
    example?: any;
  };
}

export interface ParsedKey {
  key: {
    format: string;
    primary: boolean;
    example?: any;
    entity?: string;
    rules?: {};
  };
}

export type ParsedSchema =
  | ParsedEnum
  | ParsedBoolean
  | ParsedInteger
  | ParsedFloat
  | ParsedString
  | ParsedAny
  | ParsedMap
  | ParsedObject
  | ParsedOneOf
  | ParsedArray
  | ParsedBytes
  | ParsedKey;

export type ParsedSchemaWithRef = ParsedSchema | ParsedRef;

export interface FilterableField {
  name: string;
  defaultValues: string[];
}

export type SortDirection = 'asc' | 'desc';

export interface SortableField {
  name: string;
  defaultSort?: SortDirection;
}

export interface ParsedMethodListOptions {
  filterableFields?: FilterableField[];
  searchableFields?: string[];
  sortableFields?: SortableField[];
}

export interface ParsedMethod<TSchemaWithRef extends ParsedSchemaWithRef = ParsedSchemaWithRef> {
  name: string;
  fullGrpcName: string;
  httpMethod: HTTPMethod;
  httpPath: string;
  requestBody?: TSchemaWithRef;
  responseBody?: TSchemaWithRef;
  pathParameters?: ParsedObjectProperty<TSchemaWithRef>[];
  queryParameters?: ParsedObjectProperty<TSchemaWithRef>[];
  listOptions?: ParsedMethodListOptions;
  relatedEntity?: ParsedEntity;
}

export interface ParsedService<TSchemaWithRef extends ParsedSchemaWithRef = ParsedSchemaWithRef> {
  name: string;
  methods: ParsedMethod<TSchemaWithRef>[];
}

export interface ParsedPackage<TSchemaWithRef extends ParsedSchemaWithRef = ParsedSchemaWithRef> {
  hidden?: boolean;
  introduction?: string;
  label?: string;
  name: string;
  services: ParsedService<TSchemaWithRef>[];
}

export interface ParsedSource<
  TSchema extends ParsedSchema = ParsedSchema,
  TSchemaWithRef extends ParsedSchemaWithRef = ParsedSchemaWithRef,
> {
  metadata: ParsedMetadata;
  packages: ParsedPackage<TSchemaWithRef>[];
  schemas: Map<string, TSchema>;
}

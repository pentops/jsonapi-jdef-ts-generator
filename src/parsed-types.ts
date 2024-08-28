import {
  ArrayRules,
  BooleanListRules,
  EntityObjectSchema,
  EnumListRules,
  EnumRules,
  EnumValueDescription,
  FloatListRules,
  HTTPMethod,
  IntegerListRules,
  IntegerRules,
  KeyListRules,
  NumberRules,
  ObjectRules,
  OneOfListRules,
  StateEntityEvent,
  StringListRules,
  StringRules,
} from './shared-types';
import { PackageSummary } from './generated-types';

export interface ParsedMetadata {
  builtAt: Date | null;
  version: string | undefined;
}

export interface ParsedEnumValueDescription<TSchema extends ParsedSchemaWithRef = ParsedSchemaWithRef>
  extends EnumValueDescription {
  genericReferenceToSchema?: TSchema;
}

export enum DerivedEnumHelperType {
  OneOfTypes,
  FilterFields,
  SearchFields,
  SortFields,
}

export interface ParsedEnum {
  enum: {
    fullGrpcName: string;
    name: string;
    options: ParsedEnumValueDescription[];
    prefix: string;
    rules: EnumRules;
    package?: PackageSummary;
    derivedHelperType?: DerivedEnumHelperType;
    listRules?: EnumListRules;
    example?: any;
  };
}

export interface ParsedBoolean {
  boolean: {
    const?: boolean;
    listRules?: BooleanListRules;
    example?: any;
  };
}

export interface ParsedInteger {
  integer: {
    format?: string;
    rules: IntegerRules;
    listRules?: IntegerListRules;
    example?: any;
  };
}

export interface ParsedFloat {
  float: {
    format?: string;
    rules: NumberRules;
    listRules?: FloatListRules;
    example?: any;
  };
}

export interface ParsedString {
  string: {
    format: string;
    rules: StringRules;
    listRules?: StringListRules;
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
    rules: {};
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
    package?: PackageSummary;
  };
}

export interface ParsedOneOf {
  oneOf: {
    description?: string;
    fullGrpcName: string;
    name: string;
    properties: Map<string, ParsedObjectProperty>;
    package?: PackageSummary;
    listRules?: OneOfListRules;
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
    entity?: string;
    rules?: {};
    listRules?: KeyListRules;
    example?: any;
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
  defaultFilters?: Record<string, string[]>;
  defaultSorts?: Record<string, SortDirection>;
  filterableFields?: FilterableField[];
  searchableFields?: string[];
  sortableFields?: SortableField[];
}

export interface ParsedAuthTypeCustom {
  custom: {
    passThroughHeaders: string[];
  };
}

export interface ParsedAuthTypeJWTBearer {
  jwtBearer: {};
}

export interface ParsedAuthTypeCookie {
  cookie: {};
}

export type ParsedAuthType = ParsedAuthTypeCustom | ParsedAuthTypeJWTBearer | ParsedAuthTypeCookie;

export interface ParsedMethod<TSchemaWithRef extends ParsedSchemaWithRef = ParsedSchemaWithRef> {
  name: string;
  fullGrpcName: string;
  httpMethod: HTTPMethod;
  httpPath: string;
  requestBody?: TSchemaWithRef;
  responseBody?: TSchemaWithRef;
  pathParameters?: Map<string, ParsedObjectProperty<TSchemaWithRef>> | undefined;
  queryParameters?: Map<string, ParsedObjectProperty<TSchemaWithRef>> | undefined;
  listOptions?: ParsedMethodListOptions;
  relatedEntity?: ParsedEntity;
  rootEntitySchema?: ParsedSchemaWithRef;
  parentService: ParsedService;
  auth: ParsedAuthType | undefined;
}

export interface ParsedService<TSchemaWithRef extends ParsedSchemaWithRef = ParsedSchemaWithRef> {
  name: string;
  fullGrpcName: string;
  methods: ParsedMethod<TSchemaWithRef>[];
  parentPackage: ParsedPackage;
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

import {
  ArrayRules,
  BoolListRules,
  BytesRules,
  EntityObjectSchema,
  EnumListRules,
  EnumRules,
  EnumValueDescription,
  FloatListRules,
  HTTPMethod,
  IntegerListRules,
  IntegerRules,
  KeyFormat,
  KeyListRules,
  MapRules,
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
    options: ParsedEnumValueDescription<ParsedSchema>[];
    prefix: string;
    rules: EnumRules;
    package?: PackageSummary;
    derivedHelperType?: DerivedEnumHelperType;
    listRules?: EnumListRules;
    example?: any;
  };
}

export interface ParsedBool {
  bool: {
    const?: boolean;
    listRules?: BoolListRules;
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

export interface ParsedMap<TSchema extends ParsedSchemaWithRef = ParsedSchemaWithRef> {
  map: {
    itemSchema: TSchema;
    keySchema: TSchema;
    rules: MapRules;
    keySingleForm?: string;
    example?: any;
  };
}

export interface ParsedObjectProperty<TSchema extends ParsedSchemaWithRef = ParsedSchemaWithRef> {
  description?: string;
  example?: any;
  name: string;
  readOnly?: boolean;
  required?: boolean;
  schema: TSchema;
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

export interface ParsedObject<TSchema extends ParsedSchemaWithRef = ParsedSchemaWithRef> {
  object: {
    description?: string;
    fullGrpcName: string;
    name: string;
    entity?: ParsedEntity;
    properties: Map<string, ParsedObjectProperty<TSchema>>;
    rules: ObjectRules;
    example?: any;
    additionalProperties?: boolean;
    package?: PackageSummary;
  };
}

export interface ParsedOneOf<TSchema extends ParsedSchemaWithRef = ParsedSchemaWithRef> {
  oneOf: {
    description?: string;
    fullGrpcName: string;
    name: string;
    properties: Map<string, ParsedObjectProperty<TSchema>>;
    package?: PackageSummary;
    listRules?: OneOfListRules;
    example?: any;
  };
}

export interface ParsedArray<TSchema extends ParsedSchemaWithRef = ParsedSchemaWithRef> {
  array: {
    itemSchema: TSchema;
    rules: ArrayRules;
    example?: any;
    singleForm?: string;
  };
}

export interface ParsedBytes {
  bytes: {
    rules?: BytesRules;
    example?: any;
  };
}

export interface ParsedKey {
  key: {
    format: KeyFormat;
    primary: boolean;
    entity?: string;
    rules?: {};
    listRules?: KeyListRules;
    example?: any;
  };
}

export type ParsedSchema =
  | ParsedEnum
  | ParsedBool
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

export type DereferencedParsedSchema =
  | ParsedEnum
  | ParsedBool
  | ParsedInteger
  | ParsedFloat
  | ParsedString
  | ParsedAny
  | ParsedMap<DereferencedParsedSchema>
  | ParsedObject<DereferencedParsedSchema>
  | ParsedOneOf<DereferencedParsedSchema>
  | ParsedArray<DereferencedParsedSchema>
  | ParsedBytes
  | ParsedKey;

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

export interface ParsedAuthTypeNone {
  none: {};
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

export type ParsedAuthType = ParsedAuthTypeCustom | ParsedAuthTypeJWTBearer | ParsedAuthTypeCookie | ParsedAuthTypeNone;

export interface ParsedMethod<TSchema extends ParsedSchemaWithRef = ParsedSchemaWithRef> {
  name: string;
  fullGrpcName: string;
  httpMethod: HTTPMethod;
  httpPath: string;
  requestBody?: TSchema;
  responseBody?: TSchema;
  pathParameters?: Map<string, ParsedObjectProperty<TSchema>> | undefined;
  queryParameters?: Map<string, ParsedObjectProperty<TSchema>> | undefined;
  listOptions?: ParsedMethodListOptions;
  relatedEntity?: ParsedEntity;
  rootEntitySchema?: TSchema;
  parentService: ParsedService<TSchema>;
  auth: ParsedAuthType | undefined;
}

export interface ParsedService<TSchema extends ParsedSchemaWithRef = ParsedSchemaWithRef> {
  name: string;
  fullGrpcName: string;
  methods: ParsedMethod<TSchema>[];
  parentPackage: ParsedPackage<TSchema>;
}

export interface ParsedPackage<TSchema extends ParsedSchemaWithRef = ParsedSchemaWithRef> {
  hidden?: boolean;
  introduction?: string;
  label?: string;
  name: string;
  services: ParsedService<TSchema>[];
}

export interface ParsedSource<
  TSchema extends ParsedSchema = ParsedSchema,
  TSchemaWithRef extends ParsedSchemaWithRef = ParsedSchemaWithRef,
> {
  metadata: ParsedMetadata;
  packages: ParsedPackage<TSchemaWithRef>[];
  schemas: Map<string, TSchema>;
}

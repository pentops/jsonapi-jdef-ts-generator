import {
  ArrayRules,
  BooleanListRules,
  BooleanRules,
  DateListRules,
  EntityObjectSchema,
  EnumListRules,
  EnumRules,
  EnumValueDescription,
  FloatListRules,
  IntegerListRules,
  IntegerRules,
  KeyListRules,
  NumberRules,
  ObjectRules,
  OneOfListRules,
  SortingConstraintValue,
  StateEntityEvent,
  StringListRules,
  StringRules,
  TimestampListRules,
} from './shared-types';

export interface APIMetadata {
  builtAt: string;
}

export interface APIRefFieldValue {
  ref: APIRefValue;
}

export interface APIObjectRefFieldValue extends APIRefFieldValue {
  flatten?: boolean;
}

export interface APIEnumRefFieldValue extends APIRefFieldValue {
  listRules?: EnumListRules;
}

export interface APIEnumValue {
  name: string;
  prefix: string;
  options: EnumValueDescription[];
  rules?: EnumRules;
  listRules?: EnumListRules;
}

export interface APIEnumSchema<TValue = APIEnumValue | APIEnumRefFieldValue> {
  '!type': 'enum';
  'enum': TValue;
}

export interface APIBooleanValue {
  rules?: BooleanRules;
  listRules?: BooleanListRules;
}

export interface APIBooleanSchema {
  '!type': 'boolean';
  'boolean': APIBooleanValue;
}

export interface APIObjectProperty {
  description?: string;
  name: string;
  explicitlyOptional?: boolean;
  schema: APISchema;
  required?: boolean;
  protoField: number[];
  readOnly?: boolean;
  writeOnly?: boolean;
}

export interface APIOneOfValue {
  name: string;
  description?: string;
  properties: APIObjectProperty[];
  rules?: {};
  listRules?: OneOfListRules;
}

export interface APIOneOfSchema<TValue = APIOneOfValue | APIRefFieldValue> {
  '!type': 'oneof';
  'oneof': TValue;
}

export interface APIObjectValue {
  additionalProperties?: boolean;
  description?: string;
  entity?: EntityObjectSchema;
  name: string;
  properties: APIObjectProperty[];
  rules?: ObjectRules;
  flatten?: true;
}

export interface APIObjectSchema<TValue = APIObjectValue | APIObjectRefFieldValue> {
  '!type': 'object';
  'object': TValue;
}

export interface APIIntegerValue {
  format: 'UNSPECIFIED' | 'INT32' | 'INT64' | 'UINT32' | 'UINT64';
  rules: IntegerRules;
  listRules?: IntegerListRules;
}

export interface APIIntegerSchema {
  '!type': 'integer';
  'integer': APIIntegerValue;
}

export interface APIFloatValue {
  format: 'UNSPECIFIED' | 'FLOAT32' | 'FLOAT64';
  rules: NumberRules;
  listRules?: FloatListRules;
}

export interface APIFloatSchema {
  '!type': 'float';
  'float': APIFloatValue;
}

export interface APIStringSchemaValue {
  format?: string;
  rules?: StringRules;
  listRules?: StringListRules;
}

export interface APIStringSchema {
  '!type': 'string';
  'string': APIStringSchemaValue;
}

export interface APIRefValue {
  package: string;
  schema: string;
}

export interface APIAnySchema {
  '!type': 'any';
  'any': {};
}

export interface APIMapValue {
  keySchema: APISchema;
  itemSchema: APISchema;
  rules?: {};
}

export interface APIMapSchema {
  '!type': 'map';
  'map': APIMapValue;
}

export interface APIBytesValue {
  rules?: {};
}

export interface APIBytesSchema {
  '!type': 'bytes';
  'bytes': APIBytesValue;
}

export interface APIArrayValue {
  items: APISchema;
  rules?: ArrayRules;
}

export interface APIArraySchema {
  '!type': 'array';
  'array': APIArrayValue;
}

export interface APIKeyValue {
  primary: boolean;
  entity: string;
  format: 'UNSPECIFIED' | 'UUID' | 'NATURAL_KEY';
  rules?: {};
  listRules?: KeyListRules;
}

export interface APIKeySchema {
  '!type': 'key';
  'key': APIKeyValue;
}

export interface APIDecimalValue {
  rules?: {};
}

export interface APIDecimalSchema {
  '!type': 'decimal';
  'decimal': APIDecimalValue;
}

export interface APITimestampValue {
  rules?: {};
  listRules?: TimestampListRules;
}

export interface APITimestampSchema {
  '!type': 'timestamp';
  'timestamp': APITimestampValue;
}

export interface APIDateValue {
  rules?: {};
  listRules?: DateListRules;
}

export interface APIDateSchema {
  '!type': 'date';
  'date': APIDateValue;
}

export type APISchema =
  | APIStringSchema
  | APIEnumSchema
  | APIOneOfSchema
  | APIAnySchema
  | APIBooleanSchema
  | APIMapSchema
  | APIArraySchema
  | APIObjectSchema
  | APIIntegerSchema
  | APIFloatSchema
  | APIBytesSchema
  | APIKeySchema
  | APIDecimalSchema
  | APITimestampSchema
  | APIDateSchema;

export interface APIRequestListOptionsFilterableField {
  name: string;
  defaultFilters: string[];
}

export interface APIRequestListOptionsSearchableField {
  name: string;
}

export interface APIRequestListOptionsSortableField {
  name: string;
  defaultSort?: SortingConstraintValue;
}

export interface APIRequestListOptions {
  filterableFields?: APIRequestListOptionsFilterableField[];
  searchableFields?: APIRequestListOptionsSearchableField[];
  sortableFields?: APIRequestListOptionsSortableField[];
}

export interface APIRequest {
  body?: APIObjectValue;
  list?: APIRequestListOptions;
  pathParameters?: APIObjectProperty[];
  queryParameters?: APIObjectProperty[];
}

export interface APIMethodAuthTypeNone {
  '!type': 'none';
  'none': {};
}

export interface APIMethodAuthTypeJWTBearer {
  '!type': 'jwtBearer';
  'jwtBearer': {};
}

export interface APIMethodAuthTypeCustomValue {
  passThroughHeaders: string[];
}

export interface APIMethodAuthTypeCustom {
  '!type': 'custom';
  'custom': APIMethodAuthTypeCustomValue;
}

export interface APIMethodAuthTypeCookie {
  '!type': 'cookie';
  'cookie': {};
}

export type APIMethodAuthType =
  | APIMethodAuthTypeNone
  | APIMethodAuthTypeCustom
  | APIMethodAuthTypeJWTBearer
  | APIMethodAuthTypeCookie;

export interface APIMethod {
  fullGrpcName: string;
  httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  httpPath: string;
  name: string;
  request?: APIRequest;
  responseBody?: APIObjectValue;
  auth?: APIMethodAuthType;
}

export interface APIService {
  name: string;
  methods?: APIMethod[];
}

export interface APIStateEntity {
  name: string;
  fullName: string;
  schemaName: string;
  overview?: string;
  primaryKey: string[]; // array in the case of a composite key
  queryService?: APIService;
  commandServices?: APIService[];
  events?: StateEntityEvent[];
}

export type APIRootSchema = APIObjectSchema | APIOneOfSchema | APIEnumSchema;

export interface APIPackage {
  name: string;
  label?: string;
  prose?: string;
  schemas?: Record<string, APIRootSchema>;
  stateEntities?: APIStateEntity[];
  services?: APIService[];
  hidden?: boolean;
}

export interface API {
  metadata: APIMetadata;
  packages: APIPackage[];
}

export interface APISource {
  version: string;
  api: API;
}

import {
  ArrayRules,
  BooleanRules,
  EntityObjectSchema,
  EnumValueDescription,
  IntegerRules,
  NumberRules,
  ObjectRules,
  StringRules,
} from './shared-types';

export interface APIMetadata {
  builtAt: string;
}

export interface APIRefFieldValue {
  ref: APIRefValue;
}

export interface APIEnumValue {
  name: string;
  prefix: string;
  options: EnumValueDescription[];
}

export interface APIEnumSchema {
  '!type': 'enum';
  'enum': APIEnumValue | APIRefFieldValue;
}

export interface APIBooleanValue {
  rules?: BooleanRules;
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
}

export interface APIOneOfSchema {
  '!type': 'oneof';
  'oneof': APIOneOfValue | APIRefFieldValue;
}

export interface APIObjectValue {
  additionalProperties?: boolean;
  description?: string;
  entity?: EntityObjectSchema;
  name: string;
  properties: APIObjectProperty[];
  rules?: ObjectRules;
}

export interface APIObjectSchema<TValue = APIObjectValue | APIRefFieldValue> {
  '!type': 'object';
  'object': TValue;
}

export interface APIIntegerValue {
  format: 'UNSPECIFIED' | 'INT32' | 'INT64' | 'UINT32' | 'UINT64';
  rules: IntegerRules;
}

export interface APIIntegerSchema {
  '!type': 'integer';
  'integer': APIIntegerValue;
}

export interface APIFloatValue {
  format: 'UNSPECIFIED' | 'FLOAT32' | 'FLOAT64';
  rules: NumberRules;
}

export interface APIFloatSchema {
  '!type': 'float';
  'float': APIFloatValue;
}

export interface APIStringSchemaValue {
  format?: string;
  rules?: StringRules;
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
  format: 'UNSPECIFIED' | 'UUID';
  rules?: {};
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
}

export interface APITimestampSchema {
  '!type': 'timestamp';
  'timestamp': APITimestampValue;
}

export interface APIDateValue {
  rules?: {};
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
  defaultSort?: 'UNSPECIFIED' | 'ASC' | 'DESC';
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

export interface APIMethod {
  fullGrpcName: string;
  httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  httpPath: string;
  name: string;
  request?: APIRequest;
  responseBody?: APIObjectValue;
}

export interface APIService {
  name: string;
  methods?: APIMethod[];
}

export interface APIStateEntityEvent {
  name: string;
  fullName: string;
  description?: string;
}

export interface APIStateEntity {
  name: string;
  fullName: string;
  schemaName: string;
  overview?: string;
  primaryKey: string[]; // array in the case of a composite key
  queryService?: APIService;
  commandServices?: APIService[];
  events?: APIStateEntityEvent[];
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

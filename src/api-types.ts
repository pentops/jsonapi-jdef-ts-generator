import type {
  AnyListRules,
  ArrayRules,
  BoolListRules,
  BoolRules,
  BytesRules,
  DateListRules,
  DateRules,
  DecimalListRules,
  DecimalRules,
  EntityObjectSchema,
  EnumDocs,
  EnumListRules,
  EnumRules,
  EnumValueDescription,
  FloatListRules,
  IntegerListRules,
  IntegerRules,
  KeyFormat,
  KeyListRules,
  MapRules,
  MethodType,
  NumberRules,
  ObjectRules,
  OneOfListRules,
  OneOfRules,
  SortingConstraintValue,
  StateEntityEvent,
  StringListRules,
  StringRules,
  TimestampListRules,
  TimestampRules,
} from './shared-types';

export interface APIMetadata {
  builtAt: string;
}

export interface APIRefFieldValue {
  ref: APIRefValue;
}

export interface APIObjectRefFieldValue extends APIRefFieldValue {}

export interface APIEnumRefFieldValue extends APIRefFieldValue {
  listRules?: EnumListRules;
}

export interface APIEnumValue {
  name: string;
  prefix: string;
  options: EnumValueDescription[];
  rules?: EnumRules;
  listRules?: EnumListRules;
  docs?: EnumDocs;
}

export interface APIEnumSchema<TValue = APIEnumValue | APIEnumRefFieldValue> {
  '!type': 'enum';
  'enum': TValue;
}

export interface APIBoolValue {
  const?: boolean;
  rules?: BoolRules;
  listRules?: BoolListRules;
}

export interface APIBoolSchema {
  '!type': 'bool';
  'bool': APIBoolValue;
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
  rules?: OneOfRules;
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

export interface APIAnyValueBase {
  onlyDefined?: boolean;
  listRules?: AnyListRules;
}

export interface APIAnyValueWithoutDefinedTypes extends APIAnyValueBase {
  onlyDefined: false;
}

export interface APIAnyValueWithDefinedTypes<TFullGrpcNames extends string = string> extends APIAnyValueBase {
  onlyDefined: true;
  types: TFullGrpcNames[];
}

export type APIAnyValue<TFullGrpcNames extends string = string> =
  | APIAnyValueWithoutDefinedTypes
  | APIAnyValueWithDefinedTypes<TFullGrpcNames>;

export interface APIAnySchema {
  '!type': 'any';
  'any': APIAnyValue;
}

export interface APIMapExtensions {
  keySingleForm?: string;
}

export interface APIMapValue {
  keySchema: APISchema;
  itemSchema: APISchema;
  rules?: MapRules;
  ext?: APIMapExtensions;
}

export interface APIMapSchema {
  '!type': 'map';
  'map': APIMapValue;
}

export interface APIBytesValue {
  rules?: BytesRules;
}

export interface APIBytesSchema {
  '!type': 'bytes';
  'bytes': APIBytesValue;
}

export interface APIArrayExtensions {
  singleForm?: string;
}

export interface APIArrayValue<TSchema extends APISchema = APISchema> {
  items: TSchema;
  rules?: ArrayRules;
  ext?: APIArrayExtensions;
}

export interface APIArraySchema<TSchema extends APISchema = APISchema> {
  '!type': 'array';
  'array': APIArrayValue<TSchema>;
}

export interface APIKeyExtensions {}

export interface APIEntityRef {
  package: string;
  entity: string;
}

export type APIEntityKey = { primaryKey: boolean } | { foreignKey: APIEntityRef };

export interface APIKeyValue {
  entity?: APIEntityKey;
  rules?: {};
  listRules?: KeyListRules;
  format: KeyFormat;
  ext?: APIKeyExtensions;
}

export interface APIKeySchema {
  '!type': 'key';
  'key': APIKeyValue;
}

export interface APIDecimalValue {
  rules?: DecimalRules;
  listRules?: DecimalListRules;
}

export interface APIDecimalSchema {
  '!type': 'decimal';
  'decimal': APIDecimalValue;
}

export interface APITimestampValue {
  rules?: TimestampRules;
  listRules?: TimestampListRules;
}

export interface APITimestampSchema {
  '!type': 'timestamp';
  'timestamp': APITimestampValue;
}

export interface APIDateValue {
  rules?: DateRules;
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
  | APIBoolSchema
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
  methodType?: MethodType;
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

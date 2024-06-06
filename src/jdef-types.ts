export type HTTPMethod = 'get' | 'post' | 'put' | 'delete' | 'patch';

export interface EnumValueDescription {
  description?: string;
  name: string;
  number?: number;
}

export interface EnumItem {
  'enum': string[];
  'x-enum'?: EnumValueDescription[];
}

export interface StringRules {
  pattern: string;
  // format: uint64
  minLength: string;
  // format: uint64
  maxLength: string;
}

export interface StringItem extends StringRules, Partial<EnumItem> {
  format: string;
  rules?: StringRules;
}

interface NumberRules {
  exclusiveMinimum: boolean;
  exclusiveMaximum: boolean;
  // format: double
  minimum: string;
  // format: double
  maximum: string;
  // format: double
  multipleOf: string;
}

export interface NumberItem extends NumberRules {
  format?: string;
}

export interface IntegerRules {
  exclusiveMinimum: boolean;
  exclusiveMaximum: boolean;
  // format: int64
  minimum: string;
  // format: int64
  maximum: string;
  // format: int64
  multipleOf: string;
}

export interface IntegerItem extends IntegerRules {
  format?: string;
}

export interface BooleanItem {}

export interface ObjectRules {
  // format: uint64
  minProperties?: string;
  // format: uint64
  maxProperties?: string;
}

export interface MapItem {
  'additionalProperties': SchemaWithRef | true;
  'x-key-property': SchemaWithRef;
}

export interface ObjectItem extends ObjectRules, Partial<MapItem> {
  'x-is-oneof'?: boolean;
  'properties'?: Record<string, SchemaWithRef>;
  'required'?: string[];
}

export interface ArrayRules {
  // format: uint64
  minItems: string;
  // format: uint64
  maxItems: string;
  uniqueItems: boolean;
}

export interface ArrayItem extends ArrayRules {
  items: SchemaWithRef;
}

export type SchemaType = 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object';

export interface Ref {
  $ref: string;
}

export interface BaseSchema {
  'description'?: string;
  'example'?: any;
  'type': SchemaType;
  'x-proto-name'?: string;
  'x-proto-number'?: number;
}

export interface StringSchema extends BaseSchema, StringItem {
  type: 'string';
}

export interface NumberSchema extends BaseSchema, NumberItem {
  type: 'number';
}

export interface IntegerSchema extends BaseSchema, IntegerItem {
  type: 'integer';
}

export interface BooleanSchema extends BaseSchema, BooleanItem {
  type: 'boolean';
}

export interface ObjectSchema extends BaseSchema, ObjectItem {
  'type': 'object';
  'x-proto-full-name'?: string;
}

export interface ArraySchema extends BaseSchema, ArrayItem {
  type: 'array';
}

export type Schema = StringSchema | NumberSchema | IntegerSchema | BooleanSchema | ObjectSchema | ArraySchema;

export type SchemaWithRef = Schema | Ref;

export interface Entity {
  eventSchema?: SchemaWithRef;
  stateSchema?: SchemaWithRef;
}

export interface Parameter {
  name: string;
  description?: string;
  required: boolean;
  schema?: SchemaWithRef;
}

export interface Method {
  grpcServiceName: string;
  grpcMethodName: string;
  fullGrpcName: string;
  httpMethod: HTTPMethod;
  httpPath: string;
  responseBody: SchemaWithRef;
  requestBody?: SchemaWithRef;
  pathParameters?: Parameter[];
  queryParameters?: Parameter[];
}

export interface Package {
  label: string;
  name: string;
  hidden: boolean;
  introduction?: string;
  methods: Method[];
  entities?: Entity[];
}

export interface API {
  packages: Package[];
  schemas: Record<string, Schema>;
}

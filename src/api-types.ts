import {
  ArrayRules,
  BooleanRules,
  EnumValueDescription,
  IntegerRules,
  NumberRules,
  ObjectRules,
  StringRules,
} from './shared-types';

export interface APIMetadata {
  builtAt: string;
}

export interface APIEnumValue {
  name: string;
  prefix: string;
  options: EnumValueDescription[];
}

export interface APIEnumSchema {
  '!type': 'enum';
  'enum': APIEnumValue;
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
  schema: APISchemaWithRef;
  required?: boolean;
  protoField: number[];
  readOnly?: boolean;
  writeOnly?: boolean;
}

export interface APIOneOfValue {
  name: string;
  properties: APIObjectProperty[];
  rules?: {};
}

export interface APIOneOfSchema {
  '!type': 'oneof';
  'oneof': APIOneOfValue;
}

export interface APIObjectValue {
  name: string;
  description?: string;
  properties: APIObjectProperty[];
  rules?: ObjectRules;
  additionalProperties?: boolean;
}

export interface APIObjectSchema {
  '!type': 'object';
  'object': APIObjectValue;
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

export interface APIRefSchema {
  '!type': 'ref';
  'ref': APIRefValue;
}

export interface APIAnySchema {
  '!type': 'any';
  'any': {};
}

export interface APIMapValue {
  itemSchema: APISchemaWithRef;
}

export interface APIMapSchema {
  '!type': 'map';
  'map': APIMapValue;
}

export interface APIArrayValue {
  items: APISchemaWithRef;
  rules?: ArrayRules;
}

export interface APIArraySchema {
  '!type': 'array';
  'array': APIArrayValue;
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
  | APIFloatSchema;

export type APISchemaWithRef = APISchema | APIRefSchema;

export interface APIMethod {
  fullGrpcName: string;
  httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  httpPath: string;
  name: string;
  requestBody?: APISchemaWithRef;
  responseBody?: APISchemaWithRef;
}

export interface APIService {
  name: string;
  methods?: APIMethod[];
}

export interface APIPackage {
  name: string;
  label?: string;
  introduction?: string;
  schemas?: Record<string, APISchema>;
  services?: APIService[];
  hidden?: boolean;
}

export interface API {
  metadata: APIMetadata;
  packages: APIPackage[];
}

import {
  ArrayRules,
  EnumValueDescription,
  HTTPMethod,
  IntegerRules,
  NumberRules,
  ObjectRules,
  StringRules,
} from './shared-types';

export interface ParsedMetadata {
  builtAt: Date;
}

export interface ParsedEnum {
  enum: {
    fullGrpcName: string;
    name: string;
    options: EnumValueDescription[];
    prefix: string;
  };
}

export interface ParsedBoolean {
  boolean: {
    const?: boolean;
  };
}

export interface ParsedInteger {
  integer: {
    format?: string;
    rules: IntegerRules;
  };
}

export interface ParsedFloat {
  float: {
    format?: string;
    rules: NumberRules;
  };
}

export interface ParsedString {
  string: {
    format: string;
    rules: StringRules;
  };
}

export interface ParsedRef {
  $ref: string;
}

export interface ParsedAny {
  any: {};
}

export interface ParsedMap {
  map: {
    itemSchema: ParsedSchemaWithRef;
    keySchema: ParsedSchemaWithRef;
  };
}

export interface ParsedObjectProperty {
  description?: string;
  example?: string;
  name: string;
  readOnly?: boolean;
  required?: boolean;
  schema: ParsedSchemaWithRef;
  writeOnly?: boolean;
}

export interface ParsedObject {
  object: {
    description?: string;
    fullGrpcName: string;
    name: string;
    properties: Record<string, ParsedObjectProperty>;
    rules: ObjectRules;
  };
}

export interface ParsedOneOf {
  oneOf: {
    description?: string;
    fullGrpcName: string;
    name: string;
    properties: Record<string, ParsedObjectProperty>;
  };
}

export interface ParsedArray {
  array: {
    itemSchema: ParsedSchemaWithRef;
    rules: ArrayRules;
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
  | ParsedArray;

export type ParsedSchemaWithRef = ParsedSchema | ParsedRef;

export interface ParsedMethod {
  name: string;
  fullGrpcName: string;
  httpMethod: HTTPMethod;
  httpPath: string;
  requestBody?: ParsedSchemaWithRef;
  responseBody?: ParsedSchemaWithRef;
  pathParameters?: ParsedObjectProperty[];
  queryParameters?: ParsedObjectProperty[];
}

export interface ParsedService {
  name: string;
  methods: ParsedMethod[];
}

export interface ParsedPackage {
  hidden?: boolean;
  introduction?: string;
  label?: string;
  name: string;
  services: ParsedService[];
}

export interface ParsedSource {
  metadata: ParsedMetadata;
  packages: ParsedPackage[];
  schemas: Record<string, ParsedSchema>;
}

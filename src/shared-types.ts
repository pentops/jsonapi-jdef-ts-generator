export type HTTPMethod = 'get' | 'post' | 'put' | 'delete' | 'patch';

export interface StringRules {
  pattern?: string;
  // format: uint64
  minLength?: string;
  // format: uint64
  maxLength?: string;
}

export interface IntegerRules {
  exclusiveMinimum?: boolean;
  exclusiveMaximum?: boolean;
  // format: int64
  minimum?: number;
  // format: int64
  maximum?: number;
  // format: int64
  multipleOf?: number;
}

export interface NumberRules {
  exclusiveMinimum?: boolean;
  exclusiveMaximum?: boolean;
  // format: double
  minimum?: string;
  // format: double
  maximum?: string;
  // format: double
  multipleOf?: string;
}

export interface ObjectRules {
  // format: uint64
  minProperties?: string;
  // format: uint64
  maxProperties?: string;
}

export interface ArrayRules {
  // format: uint64
  minItems?: string;
  // format: uint64
  maxItems?: string;
  uniqueItems?: boolean;
}

export interface BooleanRules {
  const?: boolean;
}

export interface EnumValueDescription {
  description?: string;
  name: string;
  number?: number;
}

import {
  ArrayRules,
  EnumValueDescription,
  HTTPMethod,
  IntegerRules,
  NumberRules,
  ObjectRules,
  StringRules,
} from './shared-types';

export interface JDEFEnumItem {
  'enum': string[];
  'x-enum'?: EnumValueDescription[];
}

export interface JDEFStringItem extends StringRules, Partial<JDEFEnumItem> {
  format: string;
}

export interface JDEFNumberItem extends NumberRules {
  format?: string;
}

export interface JDEFIntegerItem extends IntegerRules {
  format?: string;
}

export interface JDEFBooleanItem {}

export interface JDEFMapItem {
  'additionalProperties': JDEFSchemaWithRef | true;
  'x-key-property': JDEFSchemaWithRef;
}

export interface JDEFBaseObjectProperty {
  'description'?: string;
  'example'?: string;
  'required': boolean;
  'readOnly'?: boolean;
  'writeOnly'?: boolean;
  'x-proto-optional'?: boolean;
}

export interface JDEFObjectItem extends ObjectRules, Partial<JDEFMapItem> {
  'x-is-oneof'?: boolean;
  'properties'?: Record<string, JDEFObjectProperty>;
  'required'?: string[];
}

export interface JDEFArrayItem extends ArrayRules {
  items: JDEFSchemaWithRef;
}

export type JDEFSchemaType = 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object';

export interface JDEFRef {
  $ref: string;
}

export interface JDEFBaseSchema {
  description?: string;
  example?: any;
  type: JDEFSchemaType;
}

export interface JDEFStringSchema extends JDEFBaseSchema, JDEFStringItem {
  type: 'string';
}

export interface JDEFNumberSchema extends JDEFBaseSchema, JDEFNumberItem {
  type: 'number';
}

export interface JDEFIntegerSchema extends JDEFBaseSchema, JDEFIntegerItem {
  type: 'integer';
}

export interface JDEFBooleanSchema extends JDEFBaseSchema, JDEFBooleanItem {
  type: 'boolean';
}

export interface JDEFObjectSchema extends JDEFBaseSchema, JDEFObjectItem {
  'type': 'object';
  'x-name'?: string;
}

export interface JDEFArraySchema extends JDEFBaseSchema, JDEFArrayItem {
  type: 'array';
}

export type JDEFSchema =
  | JDEFStringSchema
  | JDEFNumberSchema
  | JDEFIntegerSchema
  | JDEFBooleanSchema
  | JDEFObjectSchema
  | JDEFArraySchema;

export type JDEFSchemaWithRef = JDEFSchema | JDEFRef;

export type JDEFObjectProperty =
  | (JDEFBaseObjectProperty & JDEFObjectSchema)
  | (JDEFBaseObjectProperty & JDEFRef)
  | (JDEFBaseObjectProperty & JDEFArraySchema)
  | (JDEFBaseObjectProperty & JDEFStringSchema)
  | (JDEFBaseObjectProperty & JDEFNumberSchema)
  | (JDEFBaseObjectProperty & JDEFIntegerSchema)
  | (JDEFBaseObjectProperty & JDEFBooleanSchema);

export interface JDEFEntity {
  eventSchema?: JDEFSchemaWithRef;
  stateSchema?: JDEFSchemaWithRef;
}

export interface JDEFParameter {
  name: string;
  description?: string;
  example?: string;
  required: boolean;
  readOnly?: boolean;
  schema: JDEFSchemaWithRef;
  writeOnly?: boolean;
}

export interface JDEFMethod {
  grpcServiceName: string;
  grpcMethodName: string;
  fullGrpcName: string;
  httpMethod: HTTPMethod;
  httpPath: string;
  responseBody: JDEFSchemaWithRef;
  requestBody?: JDEFSchemaWithRef;
  pathParameters?: JDEFParameter[];
  queryParameters?: JDEFParameter[];
}

export interface JDEFPackage {
  label: string;
  name: string;
  hidden: boolean;
  introduction?: string;
  methods: JDEFMethod[];
  entities?: JDEFEntity[];
}

export interface JDEFMetadata {
  built_at: {
    nanos: number;
    seconds: number;
  };
}

export interface JDEF {
  metadata: JDEFMetadata;
  packages: JDEFPackage[];
  definitions: Record<string, JDEFSchema>;
}

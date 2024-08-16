export type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;

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

export interface EnumRules {
  in?: string[];
  notIn?: string[];
}

export interface EnumValueDescription {
  description?: string;
  name: string;
  number?: number;
}

export enum EntityPart {
  Unspecified = 'UNSPECIFIED',
  Keys = 'KEYS',
  State = 'STATE',
  Event = 'EVENT',
}

export interface EntityObjectSchema {
  entity: string;
  part: EntityPart;
}

export interface StateEntityEvent {
  name: string;
  fullName: string;
  description?: string;
}

export interface FilteringConstraint {
  filterable: boolean;
  defaultFilters?: string[];
}

export interface SearchingConstraint {
  searchable: boolean;
  fieldIdentifier?: string;
}

export type SortingConstraintValue = 'UNSPECIFIED' | 'ASC' | 'DESC';

export interface SortingConstraint {
  sortable: boolean;
  defaultSort?: SortingConstraintValue;
}

export interface OneOfListRules {
  filtering?: FilteringConstraint;
}

export interface IntegerListRules {
  filtering?: FilteringConstraint;
  sorting?: SortingConstraint;
}

export interface FloatListRules {
  filtering?: FilteringConstraint;
  sorting?: SortingConstraint;
}

export interface BooleanListRules {
  filtering?: FilteringConstraint;
}

export interface DateListRules {
  filtering?: FilteringConstraint;
}

export interface EnumListRules {
  filtering?: FilteringConstraint;
}

export interface TimestampListRules {
  filtering?: FilteringConstraint;
  sorting?: SortingConstraint;
}

export interface KeyListRules {
  filtering?: FilteringConstraint;
}

export interface OpenTextListRules {
  searching?: SearchingConstraint;
}

export interface ForeignKeyListRules {
  // oneof
  uniqueString?: KeyListRules;
  uuid?: KeyListRules;
}

export interface StringListRules {
  // oneof
  openText?: OpenTextListRules;
  date?: DateListRules;
  foreignKey?: ForeignKeyListRules;
}

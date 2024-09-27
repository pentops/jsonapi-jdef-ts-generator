import type { TypeNode, TypeReferenceNode } from 'typescript';
import type { ParsedMethod, ParsedObject, ParsedOneOf, ParsedSchemaWithRef } from './parsed-types';
import type { BuiltMethodSchema } from './generated-types';
import type { IPlugin } from './plugin/types';

export type SourceType = 'jdef' | 'api';

export interface HostedSource {
  // url is the url of the hosted jdef.json or api.json file
  url: string;
  // auth is the authentication configuration for the hosted jdef.json or api.json file, if applicable
  auth?: {
    token?: string;
  };
  type?: SourceType;
}

export interface HostedSourceService {
  service: HostedSource;
}

export interface LocalSourcePath {
  path: string;
  type?: SourceType;
}

export type JSONSource = HostedSourceService | LocalSourcePath;

export interface StateConfig {
  fileName?: `${string}.json`;
  codemod: {
    source?: { globs: string[] } | { tsconfigPath: string };
    rename?: boolean;
    removeUnusedSchemas?: boolean;
  };
}

export interface TypeOutput {
  // fileName is the name of the generated types file
  fileName: `${string}.ts`;
  // directory is the directory where the generated types file will be saved
  directory: string;
  // importPath is the path that will be used to import the generated types file. If not specified, the import path will be relative to the current working directory.
  importPath?: string;
  topOfFileComment?: string;
}

export interface ClientOutput {
  // fileName is the name of the generated api client file
  fileName: `${string}.ts`;
  // directory is the directory where the generated api client file will be saved
  directory: string;
  // importPath is the path that will be used to import the generated client file. If not specified, the import path will be relative to the current working directory.
  importPath?: string;
  topOfFileComment?: string;
}

export type GenericOverrideNodeType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'any'
  | 'unknown'
  | 'undefined'
  | string; // for custom values;

export interface GenericOverride {
  name: string;
  extends?: GenericOverrideNodeType | TypeNode;
  default?: GenericOverrideNodeType | TypeNode;
}

export type GenericOverrideMap = Map<string, GenericOverride | GenericOverrideMap>;

export type GenericOverrideWithValue = GenericOverride & { value?: TypeReferenceNode | null };

export type GenericValueDeterminer = (
  schema: ParsedObject | ParsedOneOf,
  getGenericsForSchema: (schema: ParsedSchemaWithRef) => GenericOverrideMap | undefined,
  parentMethod?: BuiltMethodSchema,
) => GenericOverrideWithValue[] | undefined;

interface TypeGenerationConfig {
  // genericOverrides is a map of gRPC method names to a map of field names to generic override configurations. This can be used to override the default types of fields in generated types. Defaults to `DEFAULT_J5_LIST_GENERIC_OVERRIDES`
  genericOverrides?: Map<string, GenericOverrideMap>;
  // genericValueDeterminer
  genericValueDeterminer?: GenericValueDeterminer;
  // enumType set to union will generate union types for enums (e.g., 'test' | 'test2'), enum will generate enum types (e.g., enum Test { test = 'test', test2 = 'test2' })
  enumType: 'union' | 'enum';
  // nameWriter is a function that takes the name of a schema and returns the name of the generated type. Can be used to change the naming/casing conventions of the generated interfaces/enums.
  nameWriter: (name: string) => string;
  // requestType set to merged means that the search parameters, path parameters, and request body will be merged into a single type. When set to split, the search parameters, path parameters, and request body will be split into separate types.
  requestType: 'merged' | 'split';
}

interface ClientGenerationConfig {
  // methodNameWriter is a function that takes a jdef method and returns the name of the generated method. Can be used to change the naming/casing conventions of the generated functions.
  methodNameWriter: (method: ParsedMethod) => string;
}

export interface Config {
  // If dryRun is set to true, the generator will not write any files to disk. Output will be logged. Default is false.
  dryRun?: boolean;
  // generateIndexFiles set to false will prevent the generator from generating index files in the output directories. Default is true. If true, an index.ts file will be generated in the output directories that exports all generated types/functions. This behavior is disabled if one of the files is already an index file.
  generateIndexFiles?: boolean;
  typeOutput: TypeOutput;
  clientOutput?: ClientOutput;
  types: TypeGenerationConfig;
  client: ClientGenerationConfig;
  // plugins is an array of functions, which will be called after types and client functions have been generated, in order to enable additional codegen
  plugins?: IPlugin[];
  // jdefJsonSource is the source of the jdef.json file. Only one of service or path can be specified.
  jsonSource: JSONSource | JSONSource[];
  state?: StateConfig;
  verbose: boolean;
}

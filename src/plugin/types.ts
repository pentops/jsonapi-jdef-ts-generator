import type { ParsedSource } from '../parsed-types';
import type { Config } from '../config-types';
import type { GeneratedClientFunction, GeneratedSchema } from '../generated-types';
import type {
  PluginFileConfigCreator,
  PluginFileGeneratorConfig,
  PluginFileHooks,
  PluginFileReader,
  WritableFile,
  WrittenFile,
} from './file/types';
import type { Generator } from '../generate';
import type { ICodemod } from '../codemod/types';
import type { Project } from 'ts-morph';

export interface PluginConfig<
  TFileContentType = string,
  TFileConfig extends PluginFileGeneratorConfig<TFileContentType> = PluginFileGeneratorConfig<TFileContentType>,
> {
  defaultExistingFileReader?: PluginFileReader<TFileContentType>;
  defaultFileHooks?: PluginFileHooks<TFileContentType>;
  files?: TFileConfig[] | PluginFileConfigCreator<TFileContentType, TFileConfig>;
}

export interface IPlugin<
  TFileContentType = string,
  TFileConfig extends PluginFileGeneratorConfig<TFileContentType> = PluginFileGeneratorConfig<TFileContentType>,
  TConfig extends PluginConfig<TFileContentType, TFileConfig> = PluginConfig<TFileContentType, TFileConfig>,
  TState = unknown,
> {
  name: string;
  pluginConfig: TConfig;
  api: ParsedSource | undefined;
  config: Config | undefined;
  files: IPluginFile<TFileContentType, TFileConfig, TConfig>[];
  getFileForSchema(schema: GeneratedSchema): IPluginFile<TFileContentType, TFileConfig, TConfig> | undefined;
  getFileForClientFunction(
    clientFunction: GeneratedClientFunction,
  ): IPluginFile<TFileContentType, TFileConfig, TConfig> | undefined;
  prepare(cwd: string, api: ParsedSource, generator: Generator, previouslyWrittenPluginFiles: WrittenFile[]): void;
  run(): Promise<void>;
  postRun(): Promise<{ writtenFiles: WritableFile<TFileContentType>[] }>;
  getState(): TState | undefined;
  getCodemod: (project: Project) => ICodemod<TState> | undefined;
}

export interface GeneratedImportPath {
  importPath?: string;
  directory?: string;
  fileName?: string;
}

export interface ManualImport {
  namedImports: string[] | undefined;
  typeOnlyNamedImports?: string[];
  defaultImport?: string;
}

export interface NamedExports {
  namedExports: string[];
  typeOnlyExports: string[];
}

export interface WildcardExport {
  wildcard: true;
}

export type ManualExport = NamedExports | WildcardExport;

export interface IPluginFile<
  TFileContentType = string,
  TConfig extends PluginFileGeneratorConfig<TFileContentType> = PluginFileGeneratorConfig<TFileContentType>,
  TPluginConfig extends PluginConfig<TFileContentType, TConfig> = PluginConfig<TFileContentType, TConfig>,
  TPlugin extends IPlugin<TFileContentType, TConfig, TPluginConfig> = IPlugin<TFileContentType, TConfig, TPluginConfig>,
> {
  config: TConfig;
  existingFileContent: Promise<TFileContentType | undefined>;
  generatingPlugin: TPlugin;
  writePath: string;
  generatedTypesImportConfiguration: GeneratedImportPath;
  generatedClientImportConfiguration: GeneratedImportPath;

  getExistingFileContent(): Promise<TFileContentType | undefined>;
  setRawContent(content: string): void;
  getHasContent(): boolean;
  write(): Promise<WritableFile<TFileContentType, TConfig, TPlugin> | undefined>;
}

import type { Project } from 'ts-morph';
import type { ParsedSource } from '../parsed-types';
import type { Config } from '../config-types';
import type { GeneratedClientFunction, GeneratedSchema } from '../generated-types';
import { PluginFile, PluginFileExtractFileConfigType, PluginFileExtractFileContentType } from './file/types';
import type { Generator } from '../generate';
import type { ICodemod } from '../codemod/types';
import type { GeneratorFileReader, IGenerator, IWritableFile, WrittenFile } from '../file/types';
import { PluginEventBus, PluginEventHandlers } from './event-bus';

export type PluginFileConfigCreator<TFileConfig> = (
  generatedSchemas: Map<string, GeneratedSchema>,
  generatedClientFunctions: GeneratedClientFunction[],
) => TFileConfig[];

export interface IPluginConfig<TFile extends PluginFile<any, any> = PluginFile<any, any>> {
  defaultExistingFileReader?: GeneratorFileReader<PluginFileExtractFileContentType<TFile>>;
  hooks?: PluginEventHandlers<TFile>;
  files?: PluginFileExtractFileConfigType<TFile>[] | PluginFileConfigCreator<PluginFileExtractFileConfigType<TFile>>;
}

export interface IPluginRunOutput<
  TFile extends PluginFile<any, any> = PluginFile<any, any>,
  TGenerator extends IGenerator = IGenerator,
> {
  files: IWritableFile<PluginFileExtractFileContentType<TFile>, TGenerator>[];
}

export interface IPlugin<
  TFile extends PluginFile<any, any> = PluginFile<any, any>,
  TConfig extends IPluginConfig<TFile> = IPluginConfig<TFile>,
  TState = unknown,
> extends IGenerator {
  pluginConfig: TConfig;
  api: ParsedSource | undefined;
  config: Config | undefined;
  files: TFile[];
  eventBus: PluginEventBus<TFile> | undefined;

  getFileForSchema(schema: GeneratedSchema): TFile | undefined;
  getFileForClientFunction(clientFunction: GeneratedClientFunction): TFile | undefined;
  prepare(
    cwd: string,
    api: ParsedSource,
    generator: Generator,
    previouslyWrittenPluginFiles: WrittenFile<PluginFileExtractFileContentType<TFile>, IPlugin>[],
    eventBus: PluginEventBus<TFile>,
  ): void;
  run(): Promise<IPluginRunOutput<TFile>>; // run is the main method that assembles the nodes/file content, but doesn't write it
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

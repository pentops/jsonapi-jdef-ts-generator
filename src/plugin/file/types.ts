import { GeneratedClientFunction, GeneratedSchema } from '../../generated-types';
import { IPlugin, IPluginFile } from '../types';

export type PluginFileSchemaFilter = (schema: GeneratedSchema) => boolean;
export type PluginFileClientFunctionFilter = (clientFunction: GeneratedClientFunction) => boolean;

export type PluginFileConfigCreator<
  TFileContentType = string,
  TFileConfig extends PluginFileGeneratorConfig<TFileContentType> = PluginFileGeneratorConfig<TFileContentType>,
> = (
  generatedSchemas: Map<string, GeneratedSchema>,
  generatedClientFunctions: GeneratedClientFunction[],
) => TFileConfig[];

export type PluginFilePreBuildHook<
  TFileContentType = string,
  TFileConfig extends PluginFileGeneratorConfig<TFileContentType> = PluginFileGeneratorConfig<TFileContentType>,
> = (
  file: IPluginFile<TFileContentType, TFileConfig>,
  fileToBuild: Omit<WritableFile<TFileContentType>, 'wasWritten'>,
) => void | Promise<void>;

export type PluginFilePostBuildHook<
  TFileContentType = string,
  TFileConfig extends PluginFileGeneratorConfig<TFileContentType> = PluginFileGeneratorConfig<TFileContentType>,
> = (
  file: IPluginFile<TFileContentType, TFileConfig>,
  fileToBuild: Omit<WritableFile<TFileContentType>, 'wasWritten'>,
) => string | Promise<string>;

export type PluginFilePreWriteHook<
  TFileContentType = string,
  TFileConfig extends PluginFileGeneratorConfig<TFileContentType> = PluginFileGeneratorConfig<TFileContentType>,
  TPluginFile extends IPluginFile<TFileContentType, TFileConfig> = IPluginFile<TFileContentType, TFileConfig>,
> = (file: TPluginFile) => void | Promise<void>;

export type PluginFilePostWriteHook<
  TFileContentType = string,
  TFileConfig extends PluginFileGeneratorConfig<TFileContentType> = PluginFileGeneratorConfig<TFileContentType>,
  TPluginFile extends IPluginFile<TFileContentType, TFileConfig> = IPluginFile<TFileContentType, TFileConfig>,
> = (file: TPluginFile, writtenFile: WritableFile<TFileContentType>) => void | Promise<void>;

export type PluginFileReader<TFileContentType = string> = (
  path: string,
  directory: string,
  fileName: string,
) => Promise<TFileContentType | undefined>;

export interface PluginFileHooks<TFileContentType = string> {
  preBuildHook?: PluginFilePreBuildHook<TFileContentType>;
  postBuildHook?: PluginFilePostBuildHook<TFileContentType>;
  preWriteHook?: PluginFilePreWriteHook<TFileContentType>;
  postWriteHook?: PluginFilePostWriteHook<TFileContentType>;
}

export interface PluginFileGeneratorConfig<TFileContentType = string> extends PluginFileHooks<TFileContentType> {
  clearDirectoryBeforeWrite?: boolean;
  clientFunctionFilter?: PluginFileClientFunctionFilter | boolean;
  directory: string;
  exportFromIndexFile?: boolean;
  fileName: string;
  readExistingFile?: PluginFileReader<TFileContentType>;
  schemaFilter?: PluginFileSchemaFilter | boolean;
}

export interface WritableFile<
  TFileContentType = string,
  TConfig extends PluginFileGeneratorConfig<TFileContentType> = PluginFileGeneratorConfig<TFileContentType>,
  TPlugin extends IPlugin<TFileContentType, TConfig> = IPlugin<TFileContentType, TConfig>,
> {
  writtenByPlugin?: TPlugin;
  // content is the plain-text content of the file
  content: string;
  directory: string;
  fileName: string;
  writePath: string;
  wasWritten: boolean;
  exportFromIndexFile?: boolean;
  preExistingContent: TFileContentType | undefined;
  // writtenContent is the content of the file that was written to disk, as parsed by the preExistingFileReader
  writtenContent: TFileContentType | undefined;
}

export type WrittenFile<
  TFileContentType = string,
  TConfig extends PluginFileGeneratorConfig<TFileContentType> = PluginFileGeneratorConfig<TFileContentType>,
  TPlugin extends IPlugin<TFileContentType, TConfig> = IPlugin<TFileContentType, TConfig>,
> = Omit<WritableFile<TFileContentType, TConfig, TPlugin>, 'preExistingContent' | 'wasWritten'>;

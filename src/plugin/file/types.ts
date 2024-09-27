import type { GeneratedClientFunction, GeneratedSchema } from '../../generated-types';
import { GeneratedImportPath, IPlugin } from '../types';
import { GeneratorFile, type IGeneratorFileConfig } from '../../file/types';

export abstract class PluginFile<
  TFileContentType,
  TFileConfig extends IPluginFileConfig<TFileContentType> = IPluginFileConfig<TFileContentType>,
  TParentPlugin extends IPlugin<any, any, any> = IPlugin<any, any, any>,
> extends GeneratorFile<TFileContentType, TFileConfig, TParentPlugin> {
  generatedTypesImportConfiguration: GeneratedImportPath;
  generatedClientImportConfiguration: GeneratedImportPath;

  constructor(
    generator: TParentPlugin,
    config: TFileConfig,
    generatedTypesImportConfiguration: GeneratedImportPath,
    generatedClientImportConfiguration: GeneratedImportPath,
    writePath: string,
  ) {
    super(generator, config, writePath);

    this.generatedTypesImportConfiguration = generatedTypesImportConfiguration;
    this.generatedClientImportConfiguration = generatedClientImportConfiguration;
  }
}

export interface IPluginFileConfig<TFileContentType> extends IGeneratorFileConfig<TFileContentType> {
  clientFunctionFilter?: PluginFileClientFunctionFilter | boolean;
  schemaFilter?: PluginFileSchemaFilter | boolean;
}

export type PluginFileSchemaFilter = (schema: GeneratedSchema) => boolean;
export type PluginFileClientFunctionFilter = (clientFunction: GeneratedClientFunction) => boolean;

export type PluginFileExtractFileContentType<T> =
  T extends PluginFile<infer TFileContentType, any> ? TFileContentType : never;

export type PluginFileExtractFileConfigType<T> =
  T extends PluginFile<any, infer TFileConfigType> ? TFileConfigType : never;

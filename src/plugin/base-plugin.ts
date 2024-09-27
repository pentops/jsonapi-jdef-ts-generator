import path from 'node:path';
import { PluginFile, IPluginFileConfig } from './file/types';
import type { IPlugin, IPluginConfig, IPluginRunOutput } from './types';
import type { ParsedSource } from '../parsed-types';
import { Config } from '../config-types';
import {
  GeneratedClientFunction,
  GeneratedClientFunctionWithNodes,
  GeneratedSchema,
  GeneratedSchemaWithNode,
} from '../generated-types';
import { Generator } from '../generate';
import { BasePluginFile } from './file/base-plugin-file';
import { GeneratorFileReader, IGeneratorFileConfig, WrittenFile } from '../file/types';
import { PluginEventBus } from './event-bus';

export class BasePlugin<
  TFileContentType,
  TFileConfig extends IPluginFileConfig<TFileContentType> = IPluginFileConfig<TFileContentType>,
  TFile extends PluginFile<TFileContentType, TFileConfig, BasePlugin<any, any, any, any, any>> = PluginFile<
    TFileContentType,
    TFileConfig,
    BasePlugin<any, any, any, any, any>
  >,
  TConfig extends IPluginConfig<TFile> = IPluginConfig<TFile>,
  TState = unknown,
> implements IPlugin<TFile, TConfig, TState>
{
  name: string = 'UndefinedPlugin';

  readonly pluginConfig: TConfig;
  api: ParsedSource | undefined;
  config: Config | undefined;
  protected cwd: string | undefined;
  protected previouslyWrittenPluginFiles: WrittenFile<unknown>[] = [];
  files: TFile[] = [];
  protected generatedClientFunctions: GeneratedClientFunctionWithNodes[] = [];
  protected generatedSchemas: Map<string, GeneratedSchemaWithNode> = new Map();
  private startedAt: number | undefined;
  eventBus: PluginEventBus<TFile> | undefined;

  constructor(pluginConfig: TConfig) {
    this.pluginConfig = pluginConfig;
  }

  public prepare(
    cwd: string,
    api: ParsedSource,
    generator: Generator,
    previouslyWrittenPluginFiles: WrittenFile<unknown>[],
    eventBus: PluginEventBus<TFile>,
  ) {
    this.eventBus = eventBus;
    this.startedAt = performance.now();

    if (this.config?.verbose) {
      console.info(`[jdef-ts-generator]: plugin ${this.name} started`);
    }

    this.api = api;
    this.config = generator.config;
    this.generatedClientFunctions = generator.generatedClientFunctions;
    this.generatedSchemas = generator.generatedSchemas;
    this.cwd = cwd;
    this.previouslyWrittenPluginFiles = previouslyWrittenPluginFiles;

    if (!this.cwd) {
      throw new Error(`[jdef-ts-generator]: cwd is not set for plugin ${this.name}, files cannot be generated`);
    }

    this.initializePluginFiles();
  }

  protected initializePluginFiles() {
    const fileConfig =
      typeof this.pluginConfig.files === 'function'
        ? this.pluginConfig.files(this.generatedSchemas, this.generatedClientFunctions)
        : this.pluginConfig.files;

    this.createPluginFilesFromConfig(fileConfig);
  }

  protected createPluginFilesFromConfig(fileConfig: TFileConfig[] = []) {
    this.files = (fileConfig || []).map((fileConfig) =>
      this.createPluginFile<TFileContentType, TFileConfig>(fileConfig, this.pluginConfig.defaultExistingFileReader),
    );
  }

  protected createPluginFile<
    TContentType = TFileContentType,
    TConfigType extends IGeneratorFileConfig<TContentType> = IGeneratorFileConfig<TContentType>,
  >(fileConfig: TConfigType, pluginLevelFileReader: GeneratorFileReader<TContentType> | undefined): TFile {
    if (!this.cwd) {
      throw new Error(`[jdef-ts-generator]: cwd is not set for plugin ${this.name}, files cannot be generated`);
    }

    return new BasePluginFile<TContentType, TConfigType>(
      this,
      {
        ...fileConfig,
        readExistingFile: fileConfig.readExistingFile ?? pluginLevelFileReader,
      },
      {
        importPath: this.config?.typeOutput.importPath,
        fileName: this.config?.typeOutput.fileName,
        directory: this.config?.typeOutput.directory,
      },
      {
        importPath: this.config?.clientOutput?.importPath,
        fileName: this.config?.clientOutput?.fileName,
        directory: this.config?.clientOutput?.directory,
      },
      path.join(this.cwd, fileConfig.directory, fileConfig.fileName),
    ) as unknown as TFile;
  }

  getFileForSchema(schema: GeneratedSchema) {
    return this.files.find((file) =>
      typeof file.config.schemaFilter === 'function'
        ? file.config.schemaFilter(schema)
        : (file.config.schemaFilter ?? true),
    );
  }

  getFileForClientFunction(clientFunction: GeneratedClientFunction) {
    return this.files.find((file) =>
      typeof file.config.clientFunctionFilter === 'function'
        ? file.config.clientFunctionFilter(clientFunction)
        : (file.config.clientFunctionFilter ?? true),
    );
  }

  protected buildFiles() {
    return Promise.all(this.files.map((file) => file.build()));
  }

  async run(): Promise<IPluginRunOutput<TFile>> {
    throw new Error(
      `[jdef-ts-generator]: Plugin must implement \`run\` method, plugin ${this.name} does not have \`run\` method.`,
    );
  }

  getState(): TState | undefined {
    return undefined;
  }

  getCodemod() {
    return undefined;
  }
}

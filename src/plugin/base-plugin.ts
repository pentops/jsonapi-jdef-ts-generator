import prettyMs from 'pretty-ms';
import path from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import type {
  PluginFileGeneratorConfig,
  PluginFileHooks,
  PluginFileReader,
  WritableFile,
  WrittenFile,
} from './file/types';
import type { IPlugin, IPluginFile, PluginConfig } from './types';
import type { ParsedSource } from '../parsed-types';
import { Config } from '../config-types';
import {
  GeneratedClientFunction,
  GeneratedClientFunctionWithNodes,
  GeneratedSchema,
  GeneratedSchemaWithNode,
} from '../generated-types';
import { Generator } from '../generate';
import { logSuccess } from '../internal/helpers';
import { BasePluginFile } from './file/base-plugin-file';

export class BasePlugin<
  TFileContentType = string,
  TFileConfig extends PluginFileGeneratorConfig<TFileContentType> = PluginFileGeneratorConfig<TFileContentType>,
  TConfig extends PluginConfig<TFileContentType, TFileConfig> = PluginConfig<TFileContentType, TFileConfig>,
  TFile extends IPluginFile<TFileContentType, TFileConfig, TConfig> = IPluginFile<
    TFileContentType,
    TFileConfig,
    TConfig
  >,
  TState = unknown,
> implements IPlugin<TFileContentType, TFileConfig, TConfig, TFile, TState>
{
  name: string = 'UndefinedPlugin';

  readonly pluginConfig: TConfig;
  api: ParsedSource | undefined;
  config: Config | undefined;
  protected cwd: string | undefined;
  protected previouslyWrittenPluginFiles: WrittenFile[] = [];
  files: TFile[] = [];
  protected generatedClientFunctions: GeneratedClientFunctionWithNodes[] = [];
  protected generatedSchemas: Map<string, GeneratedSchemaWithNode> = new Map();
  private startedAt: number | undefined;

  constructor(pluginConfig: TConfig) {
    this.pluginConfig = pluginConfig;
  }

  public prepare(cwd: string, api: ParsedSource, generator: Generator, previouslyWrittenPluginFiles: WrittenFile[]) {
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
      this.createPluginFile<TFileContentType, TFileConfig, TConfig, TFile>(
        fileConfig,
        this.pluginConfig.defaultExistingFileReader,
        this.pluginConfig.defaultFileHooks,
      ),
    );
  }

  protected createPluginFile<
    TContentType = TFileContentType,
    TConfigType extends PluginFileGeneratorConfig<TContentType> = PluginFileGeneratorConfig<TContentType>,
    TPluginConfig extends PluginConfig<TContentType, TConfigType> = PluginConfig<TContentType, TConfigType>,
    TFile extends IPluginFile<TFileContentType, TFileConfig, TConfig> = IPluginFile<
      TFileContentType,
      TFileConfig,
      TConfig
    >,
  >(
    fileConfig: TConfigType,
    pluginLevelFileReader: PluginFileReader<TContentType> | undefined,
    pluginLevelFileHooks: PluginFileHooks<TContentType> | undefined,
  ): TFile {
    if (!this.cwd) {
      throw new Error(`[jdef-ts-generator]: cwd is not set for plugin ${this.name}, files cannot be generated`);
    }

    return new BasePluginFile<TContentType, TConfigType, TPluginConfig>(
      this as any,
      {
        ...fileConfig,
        readExistingFile: fileConfig.readExistingFile ?? pluginLevelFileReader,
        postBuildHook: fileConfig.postBuildHook ?? pluginLevelFileHooks?.postBuildHook,
        preBuildHook: fileConfig.preBuildHook ?? pluginLevelFileHooks?.preBuildHook,
        postWriteHook: fileConfig.postWriteHook ?? pluginLevelFileHooks?.postWriteHook,
        preWriteHook: fileConfig.preWriteHook ?? pluginLevelFileHooks?.preWriteHook,
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

  async run() {
    throw new Error(
      `[jdef-ts-generator]: Plugin must implement \`run\` method, plugin ${this.name} does not have \`run\` method.`,
    );
  }

  async postRun(): Promise<{ writtenFiles: WritableFile<TFileContentType, TFileConfig>[] }> {
    const output: { writtenFiles: WritableFile<TFileContentType, TFileConfig>[] } = { writtenFiles: [] };

    if (!this.cwd) {
      throw new Error(`[jdef-ts-generator]: cwd is not set for plugin ${this.name}, files cannot be generated`);
    }

    const directoriesToClear = new Set<string>();

    for (const file of this.files) {
      if (file.config.clearDirectoryBeforeWrite) {
        directoriesToClear.add(path.dirname(file.writePath));
      }
    }

    if (!this.config?.dryRun) {
      for (const directory of directoriesToClear) {
        try {
          await rm(directory, { recursive: true });
        } catch {}
      }
    }

    const writtenFilePaths = new Set();

    for (const file of this.files) {
      if (!this.config?.dryRun) {
        // Remove old file
        try {
          await rm(file.writePath, { recursive: true, force: true });
        } catch {}
      }

      if (file.config.preWriteHook) {
        await file.config.preWriteHook(file);
      }

      const writableFile = await file.write();

      if (writableFile) {
        if (!this.config?.dryRun) {
          // Write generated file
          await mkdir(path.dirname(writableFile.writePath), { recursive: true });
          await writeFile(writableFile.writePath, writableFile.content);

          writtenFilePaths.add(writableFile.writePath);
        } else {
          console.log(
            `[jdef-ts-generator]: dry run enabled, file from plugin ${this.name} (${writableFile.writePath}) not written. Contents:\n${writableFile.content}`,
          );
        }

        writableFile.wasWritten = true;

        if (file.config.postBuildHook) {
          await file.config.postBuildHook(file, writableFile);
        }

        output.writtenFiles.push(writableFile as WritableFile<TFileContentType, TFileConfig>);
      }
    }

    if (this.config?.verbose) {
      if (writtenFilePaths.size) {
        console.info(
          `[jdef-ts-generator]: plugin ${this.name} generated ${writtenFilePaths.size} files:\n${Array.from(writtenFilePaths).join('\n')}`,
        );
      }
    }

    if (this.startedAt) {
      logSuccess(
        `[jdef-ts-generator]: plugin ${this.name} completed in ${prettyMs(performance.now() - this.startedAt)}`,
      );
    }

    return output;
  }

  getState(): TState | undefined {
    return undefined;
  }

  getCodemod() {
    return undefined;
  }
}

import ts, { ImportDeclaration, type Node } from 'typescript';
import { match, P } from 'ts-pattern';
import fs from 'fs/promises';
import path from 'path';
import prettyMs from 'pretty-ms';
import { cleanRefName, createImportDeclaration, createNamedExportDeclaration } from './helpers';
import { Generator } from './generate';
import type { ParsedObjectProperty, ParsedSchemaWithRef, ParsedSource } from './parsed-types';
import {
  GeneratedClientFunction,
  GeneratedClientFunctionWithNodes,
  GeneratedSchema,
  GeneratedSchemaWithNode,
} from './generated-types';
import { Config } from './config-types';
import { logSuccess } from './internal/helpers';
import { getImportPath } from './fs-helpers';

const { createPrinter, createSourceFile, factory, ScriptKind, ScriptTarget, ListFormat, NewLineKind } = ts;

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
  file: PluginFile<TFileContentType, TFileConfig>,
  fileToBuild: Omit<WritableFile<TFileContentType>, 'wasWritten'>,
) => void | Promise<void>;

export type PluginFilePostBuildHook<
  TFileContentType = string,
  TFileConfig extends PluginFileGeneratorConfig<TFileContentType> = PluginFileGeneratorConfig<TFileContentType>,
> = (
  file: PluginFile<TFileContentType, TFileConfig>,
  fileToBuild: Omit<WritableFile<TFileContentType>, 'wasWritten'>,
) => string | Promise<string>;

export type PluginFilePreWriteHook<
  TFileContentType = string,
  TFileConfig extends PluginFileGeneratorConfig<TFileContentType> = PluginFileGeneratorConfig<TFileContentType>,
> = (file: PluginFile<TFileContentType, TFileConfig>) => void | Promise<void>;

export type PluginFilePostWriteHook<
  TFileContentType = string,
  TFileConfig extends PluginFileGeneratorConfig<TFileContentType> = PluginFileGeneratorConfig<TFileContentType>,
> = (
  file: PluginFile<TFileContentType, TFileConfig>,
  writtenFile: WritableFile<TFileContentType>,
) => void | Promise<void>;

export type PluginFileReader<TFileContentType = string> = (
  path: string,
  directory: string,
  fileName: string,
) => Promise<TFileContentType | undefined>;

export const defaultPluginFileReader: PluginFileReader = (path) => fs.readFile(path, { encoding: 'utf-8' });

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

export type WrittenFile = Omit<WritableFile, 'preExistingContent' | 'wasWritten'>;

export class PluginFile<
  TFileContentType = string,
  TConfig extends PluginFileGeneratorConfig<TFileContentType> = PluginFileGeneratorConfig<TFileContentType>,
  TPluginConfig extends PluginConfig<TFileContentType, TConfig> = PluginConfig<TFileContentType, TConfig>,
  TPlugin extends IPlugin<TFileContentType, TConfig, TPluginConfig> = IPlugin<TFileContentType, TConfig, TPluginConfig>,
> {
  public readonly config: TConfig;
  private readonly existingFileContent: Promise<TFileContentType | undefined>;
  private readonly generatingPlugin: TPlugin;
  private nodeList: Node[] = [];
  private readonly typeImports: Set<string>;
  private readonly clientImports: Set<string>;
  private readonly manualImports: Map<string, ManualImport>;
  private readonly manualExports: Map<string | undefined, ManualExport>;
  public writePath: string;
  private rawContent: string | undefined;
  private pendingHeaderNodes: Node[] = [];
  private pendingImportNodes: Node[] = [];
  private generatedTypesImportConfiguration: GeneratedImportPath;
  private generatedClientImportConfiguration: GeneratedImportPath;
  private printer = createPrinter({ newLine: NewLineKind.LineFeed });

  constructor(
    generatingPlugin: TPlugin,
    config: TConfig,
    generatedTypesImportConfiguration: GeneratedImportPath,
    generatedClientImportConfiguration: GeneratedImportPath,
    builtFilePath: string,
  ) {
    this.generatingPlugin = generatingPlugin;
    this.config = config;
    this.generatedTypesImportConfiguration = generatedTypesImportConfiguration;
    this.generatedClientImportConfiguration = generatedClientImportConfiguration;
    this.typeImports = new Set();
    this.clientImports = new Set();
    this.manualImports = new Map();
    this.manualExports = new Map();
    this.writePath = builtFilePath;

    // Read the file
    this.existingFileContent = (
      this.config.readExistingFile
        ? this.config.readExistingFile(builtFilePath, this.config.directory, this.config.fileName)
        : (defaultPluginFileReader(
            builtFilePath,
            this.config.directory,
            this.config.fileName,
          ) as Promise<TFileContentType>)
    ).catch((err) => {
      console.warn(
        `[jdef-ts-generator]: plugin (${generatingPlugin.name}) failed to read existing file data ${builtFilePath}`,
        err,
      );

      return undefined;
    });
  }

  public async getExistingFileContent() {
    try {
      return await this.existingFileContent;
    } catch {
      return undefined;
    }
  }

  public generateHeading(comment?: string) {
    this.pendingHeaderNodes = [
      factory.createJSDocComment(
        comment ||
          `@generated by @pentops/jsonapi-jdef-ts-generator (Plugin: ${this.generatingPlugin.name}) - do not edit`,
      ),
      factory.createIdentifier('\n'),
      ...this.pendingHeaderNodes,
    ];
  }

  private generateBlankLine(writeToFront?: boolean) {
    const node = factory.createIdentifier('\n');

    if (writeToFront) {
      this.nodeList.unshift(node);
    } else {
      this.nodeList.push(node);
    }
  }

  public addImportToOtherGeneratedFile(
    file: PluginFile<TFileContentType>,
    namedImports: string[] | undefined,
    typeOnlyNamedImports?: string[],
    defaultImport?: string,
  ) {
    if (file.config.directory === this.config.directory && file.config.fileName === this.config.fileName) {
      return;
    }

    this.addManualImport(
      getImportPath(file.config.directory, file.config.fileName, this.config.directory, this.config.fileName),
      namedImports,
      typeOnlyNamedImports,
      defaultImport,
    );
  }

  public addManualImport(
    importPath: string,
    namedImports: string[] | undefined,
    typeOnlyNamedImports?: string[],
    defaultImport?: string,
  ) {
    const existingImport = this.manualImports.get(importPath);

    if (!existingImport) {
      this.manualImports.set(importPath, {
        namedImports,
        typeOnlyNamedImports,
        defaultImport,
      });
    } else {
      this.manualImports.set(importPath, {
        ...existingImport,
        defaultImport: defaultImport || existingImport.defaultImport,
        namedImports: namedImports
          ? Array.from(new Set([...(existingImport.namedImports || []), ...(namedImports || [])]))
          : existingImport.namedImports,
        typeOnlyNamedImports: typeOnlyNamedImports
          ? Array.from(new Set([...(existingImport.typeOnlyNamedImports || []), ...(typeOnlyNamedImports || [])]))
          : existingImport.typeOnlyNamedImports,
      });
    }
  }

  public removeManualImport(importPath: string, namedImports: string[] | undefined, defaultImport?: string) {
    const existingImport = this.manualImports.get(importPath);

    if (!existingImport) {
      return;
    }

    this.manualImports.set(importPath, {
      ...existingImport,
      defaultImport: defaultImport === existingImport.defaultImport ? undefined : existingImport.defaultImport,
      namedImports: existingImport.namedImports?.filter(
        (namedImport) => !namedImports || !namedImports.includes(namedImport),
      ),
      typeOnlyNamedImports: existingImport.typeOnlyNamedImports?.filter(
        (namedImport) => !namedImports || !namedImports.includes(namedImport),
      ),
    });
  }

  public removeImportToGeneratedFile(
    file: PluginFile<TFileContentType>,
    namedImports: string[] | undefined,
    defaultImport?: string,
  ) {
    if (file.config.directory === this.config.directory && file.config.fileName === this.config.fileName) {
      return;
    }

    this.removeManualImport(
      getImportPath(file.config.directory, file.config.fileName, this.config.directory, this.config.fileName),
      namedImports,
      defaultImport,
    );
  }

  public addManualExport(exportPath: string | undefined, manualExport: ManualExport) {
    const existingExport = this.manualExports.get(exportPath);

    if (!existingExport) {
      this.manualExports.set(exportPath, manualExport);
    } else {
      this.manualExports.set(
        exportPath,
        match(manualExport)
          .with({ wildcard: true }, () => manualExport)
          .with({ namedExports: P.not(P.nullish) }, (e) => {
            const existingNamedExports = match(existingExport)
              .with({ namedExports: P.not(P.nullish) }, (e) => e.namedExports)
              .otherwise(() => []);
            const existingTypeOnlyExports = match(existingExport)
              .with({ typeOnlyExports: P.not(P.nullish) }, (e) => e.typeOnlyExports)
              .otherwise(() => []);

            return {
              namedExports: Array.from(new Set([...existingNamedExports, ...(e.namedExports || [])])),
              typeOnlyExports: Array.from(new Set([...existingTypeOnlyExports, ...(e.typeOnlyExports || [])])),
            };
          })
          .otherwise(() => existingExport),
      );
    }
  }

  public addGeneratedTypeImport(typeName: string) {
    this.typeImports.add(typeName);
  }

  public addGeneratedClientImport(clientFunctionName: string) {
    this.clientImports.add(clientFunctionName);
  }

  public setRawContent(content: string) {
    this.rawContent = content;
  }

  private generateExports() {
    const exportNodes: Node[] = [];

    for (const [exportPath, exportConfig] of this.manualExports) {
      const node = match(exportConfig)
        .with({ wildcard: true }, () =>
          exportPath
            ? factory.createExportDeclaration(
                undefined,
                false,
                undefined,
                factory.createStringLiteral(exportPath, true),
              )
            : undefined,
        )
        .with({ namedExports: P.not(P.nullish) }, (e) =>
          e.namedExports.length
            ? createNamedExportDeclaration(exportPath, e.namedExports, e.typeOnlyExports)
            : undefined,
        )
        .otherwise(() => undefined);

      if (node) {
        exportNodes.push(node);
      }
    }

    this.addNodes(...exportNodes);
  }

  private generateImports() {
    const importNodes: ImportDeclaration[] = [];

    if (this.typeImports.size) {
      const importPath = match(this.generatedTypesImportConfiguration)
        .with({ importPath: P.string }, (p) => p.importPath)
        .with({ fileName: P.string, directory: P.string }, ({ directory: d, fileName: f }) =>
          getImportPath(d, f, this.config.directory, this.config.fileName),
        )
        .otherwise(() => undefined);

      if (!importPath) {
        throw new Error(
          `[jdef-ts-generator](${this.generatingPlugin.name}): generatedTypesImportConfiguration is missing either importPath, or fileName and directory`,
        );
      }

      importNodes.push(createImportDeclaration(importPath, Array.from(this.typeImports)));
    }

    if (this.clientImports.size) {
      const importPath = match(this.generatedClientImportConfiguration)
        .with({ importPath: P.string }, (p) => p.importPath)
        .with({ fileName: P.string, directory: P.string }, ({ directory: d, fileName: f }) =>
          getImportPath(d, f, this.config.directory, this.config.fileName),
        )
        .otherwise(() => undefined);

      if (!importPath) {
        throw new Error(
          `[jdef-ts-generator](${this.generatingPlugin.name}): generatedClientImportConfiguration is missing either importPath, or fileName and directory`,
        );
      }

      importNodes.push(createImportDeclaration(importPath, Array.from(this.clientImports)));
    }

    if (this.manualImports.size) {
      for (const [importPath, { namedImports, typeOnlyNamedImports, defaultImport }] of this.manualImports) {
        importNodes.push(createImportDeclaration(importPath, namedImports, typeOnlyNamedImports, defaultImport));
      }
    }

    importNodes.sort((a, b) => {
      const aIdText = ts.isStringLiteral(a.moduleSpecifier) ? a.moduleSpecifier.text : '';
      const bIdText = ts.isStringLiteral(b.moduleSpecifier) ? b.moduleSpecifier.text : '';

      if (aIdText.startsWith('.') && !bIdText.startsWith('.')) {
        return 1;
      }

      if (!aIdText.startsWith('.') && bIdText.startsWith('.')) {
        return -1;
      }

      return aIdText.localeCompare(bIdText);
    });

    this.pendingImportNodes = importNodes;
  }

  public isFileForSchema(generatedSchema: GeneratedSchema) {
    return typeof this.config.schemaFilter === 'function'
      ? this.config.schemaFilter(generatedSchema)
      : (this.config.schemaFilter ?? true);
  }

  public isFileForGeneratedClientFunction(generatedFunction: GeneratedClientFunction) {
    return typeof this.config.clientFunctionFilter === 'function'
      ? this.config.clientFunctionFilter(generatedFunction)
      : (this.config.clientFunctionFilter ?? true);
  }

  public addNodes(...nodes: Node[]) {
    this.nodeList.push(...nodes);
  }

  public getHasContent() {
    return Boolean(this.nodeList.length > 0 || this.rawContent?.trim().length);
  }

  public async write(): Promise<WritableFile<TFileContentType> | undefined> {
    if (!this.getHasContent()) {
      return undefined;
    }

    let preExistingContent: TFileContentType | undefined;

    try {
      preExistingContent = await this.getExistingFileContent();
    } catch {}

    this.generateImports();

    if (this.rawContent) {
      let writtenContent: TFileContentType | undefined;

      if (this.config.readExistingFile) {
        try {
          writtenContent = await this.config.readExistingFile(
            this.writePath,
            this.config.directory,
            this.config.fileName,
          );
        } catch {}
      }

      return {
        exportFromIndexFile: this.config.exportFromIndexFile,
        content: this.rawContent,
        writePath: this.writePath,
        directory: this.config.directory,
        fileName: this.config.fileName,
        wasWritten: false,
        preExistingContent: preExistingContent,
        writtenContent,
        writtenByPlugin: this.generatingPlugin,
      };
    }

    if (this.pendingImportNodes.length || this.pendingHeaderNodes.length) {
      this.generateBlankLine(true);
    }

    if (this.pendingImportNodes.length) {
      this.nodeList = [...this.pendingImportNodes, ...this.nodeList];
    }

    if (this.pendingHeaderNodes.length) {
      this.nodeList = [...this.pendingHeaderNodes, ...this.nodeList];
    }

    this.generateExports();

    const writtenFile: WritableFile<TFileContentType> = {
      content: '',
      exportFromIndexFile: this.config.exportFromIndexFile,
      writePath: this.writePath,
      directory: this.config.directory,
      fileName: this.config.fileName,
      wasWritten: false,
      preExistingContent: preExistingContent,
      writtenContent: undefined,
      writtenByPlugin: this.generatingPlugin,
    };

    if (this.config.preBuildHook) {
      await this.config.preBuildHook(this, writtenFile);
    }

    writtenFile.content = this.printer.printList(
      ListFormat.MultiLine,
      factory.createNodeArray(this.nodeList),
      createSourceFile(
        this.config.fileName,
        '',
        ScriptTarget.ESNext,
        true,
        writtenFile.fileName.endsWith('.tsx') ? ScriptKind.TSX : ScriptKind.TS,
      ),
    );

    if (this.config.postBuildHook) {
      writtenFile.content = await this.config.postBuildHook(this, writtenFile);
    }

    if (this.config.readExistingFile) {
      try {
        writtenFile.writtenContent = await this.config.readExistingFile(
          this.writePath,
          this.config.directory,
          this.config.fileName,
        );
      } catch {}
    }

    return writtenFile;
  }
}

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
> {
  name: string;
  pluginConfig: TConfig;
  api: ParsedSource | undefined;
  config: Config | undefined;
  files: PluginFile<TFileContentType, TFileConfig>[];
  getFileForSchema(schema: GeneratedSchema): any;
  getFileForClientFunction(clientFunction: GeneratedClientFunction): any;
  run(): Promise<void>;
  postRun(): Promise<{ writtenFiles: WritableFile<TFileContentType>[] }>;
}

export class PluginBase<
  TFileContentType = string,
  TFileConfig extends PluginFileGeneratorConfig<TFileContentType> = PluginFileGeneratorConfig<TFileContentType>,
  TConfig extends PluginConfig<TFileContentType, TFileConfig> = PluginConfig<TFileContentType, TFileConfig>,
> implements IPlugin<TFileContentType, TFileConfig, TConfig>
{
  name: string = 'UndefinedPlugin';

  readonly pluginConfig: TConfig;
  api: ParsedSource | undefined;
  config: Config | undefined;
  protected cwd: string | undefined;
  protected previouslyWrittenPluginFiles: WrittenFile[] = [];
  files: PluginFile<TFileContentType, TFileConfig>[] = [];
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
      this.createPluginFile<TFileContentType, TFileConfig, TConfig>(
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
  >(
    fileConfig: TConfigType,
    pluginLevelFileReader: PluginFileReader<TContentType> | undefined,
    pluginLevelFileHooks: PluginFileHooks<TContentType> | undefined,
  ) {
    if (!this.cwd) {
      throw new Error(`[jdef-ts-generator]: cwd is not set for plugin ${this.name}, files cannot be generated`);
    }

    return new PluginFile<TContentType, TConfigType, TPluginConfig>(
      this as unknown as IPlugin<TContentType, TConfigType, TPluginConfig>,
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
    );
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

  protected findSchemaProperties(schema: ParsedSchemaWithRef): Map<string, ParsedObjectProperty> {
    return match(schema)
      .with({ $ref: P.not(P.nullish) }, (r) => {
        const refValue = this.generatedSchemas.get(cleanRefName(r));
        return refValue ? this.findSchemaProperties(refValue.rawSchema) : new Map<string, ParsedObjectProperty>();
      })
      .with({ object: { properties: P.not(P.nullish) } }, (r) => r.object.properties)
      .with({ oneOf: { properties: P.not(P.nullish) } }, (r) => r.oneOf.properties)
      .with({ array: { itemSchema: P.not(P.nullish) } }, (r) => this.findSchemaProperties(r.array.itemSchema))
      .otherwise(() => new Map<string, ParsedObjectProperty>());
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
          await fs.rm(directory, { recursive: true });
        } catch {}
      }
    }

    const writtenFilePaths = new Set();

    for (const file of this.files) {
      if (!this.config?.dryRun) {
        // Remove old file
        try {
          await fs.rm(file.writePath, { recursive: true, force: true });
        } catch {}
      }

      if (file.config.preWriteHook) {
        await file.config.preWriteHook(file);
      }

      const writableFile = await file.write();

      if (writableFile) {
        if (!this.config?.dryRun) {
          // Write generated file
          await fs.mkdir(path.dirname(writableFile.writePath), { recursive: true });
          await fs.writeFile(writableFile.writePath, writableFile.content);

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

        output.writtenFiles.push(writableFile as any);
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
}

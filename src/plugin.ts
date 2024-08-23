import ts, { type Node } from 'typescript';
import { P, match } from 'ts-pattern';
import fs from 'fs/promises';
import path from 'path';
import prettyMs from 'pretty-ms';
import { createImportDeclaration, createNamedExportDeclaration, getImportPath } from './helpers';
import { Generator } from './generate';
import type { ParsedSource } from './parsed-types';
import type {
  GeneratedClientFunction,
  GeneratedClientFunctionWithNodes,
  GeneratedSchema,
  GeneratedSchemaWithNode,
} from './generated-types';
import { Config } from './config';
import { logSuccess } from './internal/helpers';

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
> = (file: PluginFile<TFileContentType, TFileConfig>, fileToBuild: Omit<WritableFile, 'wasWritten'>) => void;

export type PluginFilePostBuildHook<
  TFileContentType = string,
  TFileConfig extends PluginFileGeneratorConfig<TFileContentType> = PluginFileGeneratorConfig<TFileContentType>,
> = (file: PluginFile<TFileContentType, TFileConfig>, fileToBuild: Omit<WritableFile, 'wasWritten'>) => string;

export type PluginFilePreWriteHook<
  TFileContentType = string,
  TFileConfig extends PluginFileGeneratorConfig<TFileContentType> = PluginFileGeneratorConfig<TFileContentType>,
> = (file: PluginFile<TFileContentType, TFileConfig>) => void;

export type PluginFilePostWriteHook<
  TFileContentType = string,
  TFileConfig extends PluginFileGeneratorConfig<TFileContentType> = PluginFileGeneratorConfig<TFileContentType>,
> = (file: PluginFile<TFileContentType, TFileConfig>, writtenFile: WritableFile) => void;

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
  directory: string;
  exportFromIndexFile?: boolean;
  fileName: string;
  schemaFilter?: PluginFileSchemaFilter | boolean;
  clientFunctionFilter?: PluginFileClientFunctionFilter | boolean;
  readExistingFile?: PluginFileReader<TFileContentType>;
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

export interface WritableFile {
  content: string;
  directory: string;
  fileName: string;
  writePath: string;
  wasWritten: boolean;
  exportFromIndexFile?: boolean;
}

export class PluginFile<
  TFileContentType = string,
  TConfig extends PluginFileGeneratorConfig<TFileContentType> = PluginFileGeneratorConfig<TFileContentType>,
> {
  public readonly config: TConfig;
  private readonly existingFileContent: Promise<TFileContentType | undefined>;
  private readonly generatingPluginName: string;
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
    generatingPluginName: string,
    config: TConfig,
    generatedTypesImportConfiguration: GeneratedImportPath,
    generatedClientImportConfiguration: GeneratedImportPath,
    builtFilePath: string,
  ) {
    this.generatingPluginName = generatingPluginName;
    this.config = config;
    this.generatedTypesImportConfiguration = generatedTypesImportConfiguration;
    this.generatedClientImportConfiguration = generatedClientImportConfiguration;
    this.typeImports = new Set();
    this.clientImports = new Set();
    this.manualImports = new Map();
    this.manualExports = new Map();
    this.writePath = builtFilePath;

    // Read the file
    this.existingFileContent = this.config.readExistingFile
      ? this.config.readExistingFile(builtFilePath, this.config.directory, this.config.fileName)
      : (defaultPluginFileReader(
          builtFilePath,
          this.config.directory,
          this.config.fileName,
        ) as Promise<TFileContentType>);
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
          `@generated by @pentops/jsonapi-jdef-ts-generator (Plugin: ${this.generatingPluginName}) - do not edit`,
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
    file: PluginFile,
    namedImports: string[] | undefined,
    typeOnlyNamedImports?: string[],
    defaultImport?: string,
  ) {
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
    const importNodes: Node[] = [];

    if (this.typeImports.size) {
      const importPath = match(this.generatedTypesImportConfiguration)
        .with({ importPath: P.string }, (p) => p.importPath)
        .with({ fileName: P.string, directory: P.string }, ({ directory: d, fileName: f }) =>
          getImportPath(d, f, this.config.directory, this.config.fileName),
        )
        .otherwise(() => undefined);

      if (!importPath) {
        throw new Error(
          `[jdef-ts-generator](${this.generatingPluginName}): generatedTypesImportConfiguration is missing either importPath, or fileName and directory`,
        );
      }

      const typeImports = Array.from(this.typeImports);
      importNodes.push(createImportDeclaration(importPath, typeImports, typeImports));
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
          `[jdef-ts-generator](${this.generatingPluginName}): generatedClientImportConfiguration is missing either importPath, or fileName and directory`,
        );
      }

      importNodes.push(createImportDeclaration(importPath, Array.from(this.clientImports)));
    }

    if (this.manualImports.size) {
      for (const [importPath, { namedImports, typeOnlyNamedImports, defaultImport }] of this.manualImports) {
        importNodes.push(createImportDeclaration(importPath, namedImports, typeOnlyNamedImports, defaultImport));
      }
    }

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

  public async write(): Promise<WritableFile | undefined> {
    if (!this.getHasContent()) {
      return undefined;
    }

    this.generateImports();

    if (this.rawContent) {
      return {
        exportFromIndexFile: this.config.exportFromIndexFile,
        content: this.rawContent,
        writePath: this.writePath,
        directory: this.config.directory,
        fileName: this.config.fileName,
        wasWritten: false,
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

    const writtenFile: WritableFile = {
      content: '',
      exportFromIndexFile: this.config.exportFromIndexFile,
      writePath: this.writePath,
      directory: this.config.directory,
      fileName: this.config.fileName,
      wasWritten: false,
    };

    if (this.config.preBuildHook) {
      await this.config.preBuildHook?.(this, writtenFile);
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

export class PluginBase<
  TFileContentType = string,
  TFileConfig extends PluginFileGeneratorConfig<TFileContentType> = PluginFileGeneratorConfig<TFileContentType>,
  TConfig extends PluginConfig<TFileContentType, TFileConfig> = PluginConfig<TFileContentType, TFileConfig>,
> {
  name: string = 'UndefinedPlugin';

  protected readonly pluginConfig: TConfig;
  protected api: ParsedSource | undefined;
  protected config: Config | undefined;
  protected cwd: string | undefined;
  protected files: PluginFile<TFileContentType, TFileConfig>[] = [];
  protected generatedClientFunctions: GeneratedClientFunctionWithNodes[] = [];
  protected generatedSchemas: Map<string, GeneratedSchemaWithNode> = new Map();
  private startedAt: number | undefined;

  constructor(pluginConfig: TConfig) {
    this.pluginConfig = pluginConfig;
  }

  public prepare(cwd: string, api: ParsedSource, generator: Generator, initializePluginFiles = true) {
    this.startedAt = performance.now();

    console.info(`[jdef-ts-generator]: plugin ${this.name} started`);

    this.api = api;
    this.config = generator.config;
    this.generatedClientFunctions = generator.generatedClientFunctions;
    this.generatedSchemas = generator.generatedSchemas;
    this.cwd = cwd;

    if (!this.cwd) {
      throw new Error(`[jdef-ts-generator]: cwd is not set for plugin ${this.name}, files cannot be generated`);
    }

    if (initializePluginFiles) {
      this.initializePluginFiles();
    }
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
      this.createPluginFile<TFileContentType, TFileConfig>(
        fileConfig,
        this.pluginConfig.defaultExistingFileReader,
        this.pluginConfig.defaultFileHooks,
      ),
    );
  }

  protected createPluginFile<
    TContentType = TFileContentType,
    TConfigType extends PluginFileGeneratorConfig<TContentType> = PluginFileGeneratorConfig<TContentType>,
  >(
    fileConfig: TConfigType,
    pluginLevelFileReader: PluginFileReader<TContentType> | undefined,
    pluginLevelFileHooks: PluginFileHooks<TContentType> | undefined,
  ) {
    if (!this.cwd) {
      throw new Error(`[jdef-ts-generator]: cwd is not set for plugin ${this.name}, files cannot be generated`);
    }

    return new PluginFile<TContentType, TConfigType>(
      this.name,
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

  protected getFileForSchema(schema: GeneratedSchema) {
    return this.files.find((file) =>
      typeof file.config.schemaFilter === 'function'
        ? file.config.schemaFilter(schema)
        : (file.config.schemaFilter ?? true),
    );
  }

  protected getFileForClientFunction(clientFunction: GeneratedClientFunction) {
    return this.files.find((file) =>
      typeof file.config.clientFunctionFilter === 'function'
        ? file.config.clientFunctionFilter(clientFunction)
        : (file.config.clientFunctionFilter ?? true),
    );
  }

  public async run() {
    throw new Error(
      `[jdef-ts-generator]: Plugin must implement \`run\` method, plugin ${this.name} does not have \`run\` method.`,
    );
  }

  public async postRun(): Promise<{ writtenFiles: WritableFile[] }> {
    const output: { writtenFiles: WritableFile[] } = { writtenFiles: [] };

    for (const file of this.files) {
      if (!this.cwd) {
        throw new Error(`[jdef-ts-generator]: cwd is not set for plugin ${this.name}, files cannot be generated`);
      }

      if (!this.config?.dryRun) {
        // Remove old file
        await fs.rm(file.writePath, { recursive: true, force: true });
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

          console.info(`[jdef-ts-generator]: plugin ${this.name} generated file ${writableFile.writePath}`);
        } else {
          console.info(
            `[jdef-ts-generator]: dry run enabled, file from plugin ${this.name} (${writableFile.writePath}) not written. Contents:\n${writableFile.content}`,
          );
        }

        writableFile.wasWritten = true;

        if (file.config.postBuildHook) {
          await file.config.postBuildHook(file, writableFile);
        }

        output.writtenFiles.push(writableFile);
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

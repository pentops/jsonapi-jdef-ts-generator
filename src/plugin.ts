import { Config } from './config';
import ts, { type Node } from 'typescript';
import { createImportDeclaration, createNamedExportDeclaration, getImportPath } from './helpers';
import fs from 'fs';
import path from 'path';
import { Generator } from './generate';
import { P, match } from 'ts-pattern';
import type { ParsedSource } from './parsed-types';
import type { GeneratedClientFunction, GeneratedSchema } from './generated-types';

const { createPrinter, createSourceFile, factory, ScriptKind, ScriptTarget, ListFormat, NewLineKind } = ts;

export type PluginFileSchemaFilter = (schema: GeneratedSchema) => boolean;
export type PluginFileClientFunctionFilter = (clientFunction: GeneratedClientFunction) => boolean;

export type PluginFileConfigCreator<TFileConfig extends PluginFileGeneratorConfig = PluginFileGeneratorConfig> = (
  generatedSchemas: Map<string, GeneratedSchema>,
  generatedClientFunctions: GeneratedClientFunction[],
) => TFileConfig[];

export type PluginFilePreBuildHook = (file: PluginFile, fileToBuild: Omit<WritableFile, 'writtenTo'>) => void;
export type PluginFilePostBuildHook = (file: PluginFile, fileToBuild: Omit<WritableFile, 'writtenTo'>) => string;
export type PluginFilePreWriteHook = (file: PluginFile) => void;
export type PluginFilePostWriteHook = (file: PluginFile, writtenFile: WritableFile) => void;

export interface PluginFileGeneratorConfig {
  directory: string;
  fileName: string;
  schemaFilter?: PluginFileSchemaFilter | boolean;
  clientFunctionFilter?: PluginFileClientFunctionFilter | boolean;
  readExistingFileConfig?:
    | {
        encoding: BufferEncoding;
        flag?: string | undefined;
      }
    | BufferEncoding;
  preBuildHook?: PluginFilePreBuildHook;
  postBuildHook?: PluginFilePostBuildHook;
  preWriteHook?: PluginFilePreWriteHook;
  postWriteHook?: PluginFilePostWriteHook;
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
  writtenTo: string;
}

export class PluginFile<TConfig extends PluginFileGeneratorConfig = PluginFileGeneratorConfig> {
  public readonly config: TConfig;
  public readonly existingFileContent: string | undefined;
  private readonly generatingPluginName: string;
  private nodeList: Node[] = [];
  private readonly typeImports: Set<string>;
  private readonly clientImports: Set<string>;
  private readonly manualImports: Map<string, ManualImport>;
  private readonly manualExports: Map<string, ManualExport>;
  private rawContent: string | undefined;
  private pendingHeaderNodes: Node[] = [];
  private pendingImportNodes: Node[] = [];
  private pendingManualImportNodes: Node[] = [];
  private generatedTypesImportConfiguration: GeneratedImportPath;
  private generatedClientImportConfiguration: GeneratedImportPath;
  private printer = createPrinter({ newLine: NewLineKind.LineFeed });

  constructor(
    generatingPluginName: string,
    config: TConfig,
    generatedTypesImportConfiguration: GeneratedImportPath,
    generatedClientImportConfiguration: GeneratedImportPath,
    existingFileContent: string | undefined,
  ) {
    this.generatingPluginName = generatingPluginName;
    this.config = config;
    this.generatedTypesImportConfiguration = generatedTypesImportConfiguration;
    this.generatedClientImportConfiguration = generatedClientImportConfiguration;
    this.typeImports = new Set();
    this.clientImports = new Set();
    this.manualImports = new Map();
    this.manualExports = new Map();
    this.existingFileContent = existingFileContent;
  }

  public generateHeading(comment?: string) {
    this.pendingHeaderNodes = [
      factory.createJSDocComment(
        comment ||
          `@generated by @pentops/jsonapi-jdef-ts-generator (Plugin: ${this.generatingPluginName}) - do not edit`,
      ),
      factory.createIdentifier('\n'),
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

  public addManualExport(exportPath: string, manualExport: ManualExport) {
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
          factory.createExportDeclaration(undefined, false, undefined, factory.createStringLiteral(exportPath, true)),
        )
        .with({ namedExports: P.not(P.nullish) }, (e) =>
          e.namedExports.length ? createNamedExportDeclaration(e.namedExports, e.typeOnlyExports) : undefined,
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

  public addNodes(...nodes: Node[]) {
    this.nodeList.push(...nodes);
  }

  public getHasContent() {
    return Boolean(this.nodeList.length > 0 || this.rawContent?.trim().length);
  }

  public write(): WritableFile | undefined {
    if (!this.getHasContent()) {
      return undefined;
    }

    this.generateImports();

    if (this.rawContent) {
      return {
        content: this.rawContent,
        directory: this.config.directory,
        fileName: this.config.fileName,
        writtenTo: '', // set when written
      };
    }

    if (this.pendingImportNodes.length || this.pendingManualImportNodes.length || this.pendingHeaderNodes.length) {
      this.generateBlankLine(true);
    }

    if (this.pendingImportNodes.length) {
      this.nodeList = [...this.pendingImportNodes, ...this.nodeList];
    }

    if (this.pendingManualImportNodes.length) {
      this.nodeList = [...this.pendingManualImportNodes, ...this.nodeList];
    }

    if (this.pendingHeaderNodes.length) {
      this.nodeList = [...this.pendingHeaderNodes, ...this.nodeList];
    }

    this.generateExports();

    const writtenFile: WritableFile = {
      content: '',
      directory: this.config.directory,
      fileName: this.config.fileName,
      writtenTo: '', // set when written
    };

    this.config.preBuildHook?.(this, writtenFile);

    writtenFile.content = this.printer.printList(
      ListFormat.MultiLine,
      factory.createNodeArray(this.nodeList),
      createSourceFile(this.config.fileName, '', ScriptTarget.ESNext, true, ScriptKind.TS),
    );

    if (this.config.postBuildHook) {
      writtenFile.content = this.config.postBuildHook(this, writtenFile);
    }

    return writtenFile;
  }
}

export interface PluginConfig<TFileConfig extends PluginFileGeneratorConfig = PluginFileGeneratorConfig> {
  files?: TFileConfig[] | PluginFileConfigCreator<TFileConfig>;
}

export class PluginBase<
  TFileConfig extends PluginFileGeneratorConfig = PluginFileGeneratorConfig,
  TConfig extends PluginConfig<TFileConfig> = PluginConfig<TFileConfig>,
> {
  name: string = 'UndefinedPlugin';

  protected readonly pluginConfig: TConfig;
  protected api: ParsedSource | undefined;
  protected config: Config | undefined;
  protected cwd: string | undefined;
  protected files: PluginFile<TFileConfig>[] = [];
  protected generatedClientFunctions: GeneratedClientFunction[] = [];
  protected generatedSchemas: Map<string, GeneratedSchema> = new Map();
  private startedAt: number | undefined;

  constructor(pluginConfig: TConfig) {
    this.pluginConfig = pluginConfig;
  }

  public prepare(cwd: string, api: ParsedSource, generator: Generator) {
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

    const fileConfig =
      typeof this.pluginConfig.files === 'function'
        ? this.pluginConfig.files(this.generatedSchemas, this.generatedClientFunctions)
        : this.pluginConfig.files;
    this.files = (fileConfig || []).map((fileConfig) => this.createPluginFile(fileConfig));
  }

  protected createPluginFile<T extends PluginFileGeneratorConfig = TFileConfig>(fileConfig: T) {
    if (!this.cwd) {
      throw new Error(`[jdef-ts-generator]: cwd is not set for plugin ${this.name}, files cannot be generated`);
    }

    let existingFileContent: string | undefined;

    try {
      existingFileContent = fs.readFileSync(
        path.join(this.cwd, fileConfig.directory, fileConfig.fileName),
        fileConfig.readExistingFileConfig || { encoding: 'utf-8' },
      );
    } catch {}

    return new PluginFile<T>(
      this.name,
      fileConfig,
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
      existingFileContent,
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

  public postRun(): { writtenFiles: WritableFile[] } {
    const output: { writtenFiles: WritableFile[] } = { writtenFiles: [] };

    for (const file of this.files) {
      if (!this.cwd) {
        throw new Error(`[jdef-ts-generator]: cwd is not set for plugin ${this.name}, files cannot be generated`);
      }

      const generatedFilePath = path.join(this.cwd, file.config.directory, file.config.fileName);

      if (!this.config?.dryRun) {
        // Remove old file
        fs.rmSync(generatedFilePath, { recursive: true, force: true });
      }

      file.config.preWriteHook?.(file);
      const writableFile = file.write();

      if (writableFile) {
        if (!this.config?.dryRun) {
          // Write generated file
          fs.mkdirSync(path.dirname(generatedFilePath), { recursive: true });
          fs.writeFileSync(generatedFilePath, writableFile.content);

          console.info(`[jdef-ts-generator]: plugin ${this.name} generated file ${generatedFilePath}`);
        } else {
          console.info(
            `[jdef-ts-generator]: dry run enabled, file from plugin ${this.name} (${generatedFilePath}) not written. Contents:\n${writableFile.content}`,
          );
        }

        writableFile.writtenTo = generatedFilePath;
        file.config.postBuildHook?.(file, writableFile);
        output.writtenFiles.push(writableFile);
      }
    }

    if (this.startedAt) {
      console.info(`[jdef-ts-generator]: plugin ${this.name} completed in ${performance.now() - this.startedAt}ms`);
    }

    return output;
  }
}

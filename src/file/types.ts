import { readFile } from 'node:fs/promises';
import { PluginEventBus } from '../plugin';

export const DEFAULT_MAX_FILE_LOAD_TIME = 5000;

export type GeneratorFileReadStatus = 'success' | 'pending' | 'not-found' | 'error';

export interface GeneratorFileState<TFileContentType = string> {
  status: GeneratorFileReadStatus;
  content: TFileContentType | undefined;
}

export type GeneratorFileReader<TFileContentType> = (
  path: string,
  directory: string,
  fileName: string,
) => Promise<TFileContentType | undefined>;

export type GeneratorFileConverter<TFileContentType> = (
  stringContent: string | undefined,
) => TFileContentType | undefined;

export interface IGeneratorFileConfig<TFileContentType> {
  clearDirectoryBeforeWrite?: boolean;
  directory: string;
  exportFromIndexFile?: boolean;
  fileName: string;
  readExistingFile?: GeneratorFileReader<TFileContentType>;
  convertStringContentToFileContentType?: GeneratorFileConverter<TFileContentType>;
  maxExistingFileLoadTime?: number;
}

export interface IWritableFile<TContentType = string, TGenerator extends IGenerator = IGenerator> {
  writtenBy: TGenerator;
  // content is the plain-text content of the file
  content: string;
  directory: string;
  clearDirectoryBeforeWrite: boolean;
  fileName: string;
  writePath: string;
  wasWritten: boolean;
  exportFromIndexFile?: boolean;
  preExistingContent: TContentType | undefined;
  // writtenContent is the content of the file that was written to disk, as parsed by the preExistingFileReader
  writtenContent: TContentType | undefined;
}

export type WrittenFile<TContentType = string, TGenerator extends IGenerator = IGenerator> = Omit<
  IWritableFile<TContentType, TGenerator>,
  'preExistingContent' | 'wasWritten'
>;

export const defaultGeneratorFileReader: GeneratorFileReader<any> = (path) => readFile(path, { encoding: 'utf-8' });
export const defaultGeneratorFileConverter: GeneratorFileConverter<any> = (content) => content;

export interface IGenerator {
  name: string;
  eventBus: PluginEventBus<any> | undefined;
}

export type GeneratorFileExtractFileContentType<T> =
  T extends GeneratorFile<infer TFileContentType, any, any> ? TFileContentType : any;

export type GeneratorFileExtractFileConfigType<T> =
  T extends GeneratorFile<any, infer TFileConfigType, any> ? TFileConfigType : any;

export type GeneratorFileExtractGeneratorType<T> =
  T extends GeneratorFile<any, any, infer TGenerator> ? TGenerator : any;

export abstract class GeneratorFile<
  TFileContentType = any,
  TFileConfig extends IGeneratorFileConfig<TFileContentType> = IGeneratorFileConfig<TFileContentType>,
  TGenerator extends IGenerator = IGenerator,
> {
  config: TFileConfig;
  existingFileContent: GeneratorFileState<TFileContentType> = { status: 'pending', content: undefined };
  generator: TGenerator;
  writePath: string;
  protected _builtFile: IWritableFile<TFileContentType, TGenerator> | undefined | null; // undefined means the file hasn't been built yet, null means it's a skipped file

  constructor(generator: TGenerator, config: TFileConfig, writePath: string) {
    this.config = config;
    this.generator = generator;
    this.writePath = writePath;

    this.getExistingFileContent().then().catch();
  }

  public async pollForExistingFileContent(): Promise<GeneratorFileState<TFileContentType>> {
    return new Promise((resolve) => {
      const startTime = Date.now();

      const interval = setInterval(() => {
        if (this.existingFileContent.status === 'success') {
          clearInterval(interval);
          resolve(this.existingFileContent);
        } else if (this.existingFileContent.status === 'error') {
          clearInterval(interval);
          resolve(this.existingFileContent);
        } else if (Date.now() - startTime > (this.config.maxExistingFileLoadTime || DEFAULT_MAX_FILE_LOAD_TIME)) {
          clearInterval(interval);
          resolve(this.existingFileContent);
        }
      }, 50);
    });
  }

  async getExistingFileContent(): Promise<void> {
    try {
      this.existingFileContent.status = 'pending';
      const content = await this.config.readExistingFile?.(this.writePath, this.config.directory, this.config.fileName);
      this.existingFileContent = { status: 'success', content };
    } catch {
      this.existingFileContent.status = 'error';
    }
  }

  getHasContent(): boolean {
    return false;
  }

  abstract buildContent(): Promise<IWritableFile<TFileContentType> | undefined>;

  abstract build(): Promise<IWritableFile<TFileContentType> | undefined>;
}

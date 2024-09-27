import mitt, { Emitter } from 'mitt';
import {
  GeneratorFile,
  GeneratorFileExtractFileConfigType,
  GeneratorFileExtractFileContentType,
  GeneratorFileExtractGeneratorType,
  IWritableFile,
} from '../file/types';
import { PluginFileExtractFileContentType } from './file/types';

export type PluginEvent<TFile extends GeneratorFile<any, any, any>> = {
  preBuildFile: {
    file: TFile;
  };
  postBuildFile: {
    file: TFile;
    builtFile: Omit<IWritableFile<PluginFileExtractFileContentType<TFile>>, 'wasWritten'>;
  };
  preWriteFile: {
    file: Omit<IWritableFile<PluginFileExtractFileContentType<TFile>>, 'wasWritten'>;
  };
  postWriteFile: {
    file: IWritableFile<PluginFileExtractFileContentType<TFile>>;
  };
};

export function createPluginEventBus<
  TFile extends GeneratorFile<
    GeneratorFileExtractFileContentType<TFile>,
    GeneratorFileExtractFileConfigType<TFile>,
    GeneratorFileExtractGeneratorType<TFile>
  >,
>() {
  return mitt<PluginEvent<TFile>>();
}

export type PluginEventBus<TFile extends GeneratorFile<any, any, any>> = Emitter<PluginEvent<TFile>>;

export type PluginEventHandlers<TFile extends GeneratorFile<any, any, any>> = Partial<{
  [K in keyof PluginEvent<TFile>]: (payload: PluginEvent<TFile>[K]) => void;
}>;

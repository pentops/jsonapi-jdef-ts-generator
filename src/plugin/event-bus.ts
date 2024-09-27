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
    fileToBuild: Omit<IWritableFile<PluginFileExtractFileContentType<TFile>>, 'wasWritten'>;
  };
  postBuildFile: {
    file: TFile;
    fileToBuild: Omit<IWritableFile<PluginFileExtractFileContentType<TFile>>, 'wasWritten'>;
  };
  preWriteFile: {
    file: TFile;
  };
  postWriteFile: {
    file: TFile;
    writtenFile: IWritableFile<PluginFileExtractFileContentType<TFile>>;
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

export type PluginEventHandlers<TFile extends GeneratorFile<any, any, any>> = {
  [K in keyof PluginEvent<TFile>]: (payload: PluginEvent<TFile>[K]) => void;
};

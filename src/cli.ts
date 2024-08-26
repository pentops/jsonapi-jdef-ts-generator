import fs from 'fs';
import path from 'path';
import prettyMs from 'pretty-ms';
import { loadConfig } from './config';
import { getSource } from './get-source';
import { Generator } from './generate';
import { logSuccess } from './internal/helpers';
import { WrittenFile } from './plugin';

interface Args {
  cwd: string;
  args: string[];
}

export async function cli({ cwd, args }: Args) {
  const start = performance.now();

  const config = await loadConfig();

  const api = await getSource(config.jsonSource);

  if (!api) {
    throw new Error('[jdef-ts-generator]: no valid source found');
  }

  console.info('[jdef-ts-generator]: loaded source, beginning type generation');

  const generator = new Generator(config);

  const { clientFile, typesFile } = generator.generate(api);
  const builtFilesByDirectory = new Map<string, Set<string>>();

  function addFileToDirectory(directory: string, fileName: string) {
    if (!builtFilesByDirectory.has(directory)) {
      builtFilesByDirectory.set(directory, new Set());
    }

    builtFilesByDirectory.get(directory)?.add(fileName);
  }

  // Clear types output path
  const typeOutputPath = path.join(cwd, config.typeOutput.directory, config.typeOutput.fileName);
  const typeOutputDir = path.dirname(typeOutputPath);

  if (!config.dryRun) {
    fs.rmSync(typeOutputDir, { recursive: true, force: true });

    // Write generated file
    fs.mkdirSync(typeOutputDir, { recursive: true });
    fs.writeFileSync(typeOutputPath, typesFile);

    console.info('[jdef-ts-generator]: interfaces and enums generated and saved to disk');
  } else {
    console.info(`[jdef-ts-generator]: dry run enabled, file ${typeOutputPath} not written. Contents:\n${typesFile}`);
  }

  addFileToDirectory(typeOutputDir, typeOutputPath);

  if (config.clientOutput) {
    if (clientFile) {
      const clientOutputPath = path.join(
        cwd,
        config.clientOutput.directory,
        config.clientOutput.fileName || 'client.ts',
      );
      const clientOutputDir = path.dirname(clientOutputPath);

      // Clear output directory and recreate if it's not already been written to
      if (!config.dryRun && !builtFilesByDirectory.has(clientOutputDir)) {
        fs.rmSync(clientOutputDir, { recursive: true, force: true });
        fs.mkdirSync(clientOutputDir, { recursive: true });
      }

      if (!config.dryRun) {
        // Write generated file
        fs.writeFileSync(clientOutputPath, clientFile);

        console.info('[jdef-ts-generator]: api client generated and saved to disk');
      } else {
        console.info(
          `[jdef-ts-generator]: dry run enabled, file ${clientOutputPath} not written. Contents:\n${clientFile}`,
        );
      }

      addFileToDirectory(clientOutputDir, clientOutputPath);
    }
  }

  if (config.plugins) {
    const writtenPluginFiles = new Set<WrittenFile>();

    for (const plugin of config.plugins) {
      plugin.prepare(cwd, api, generator, Array.from(writtenPluginFiles));

      await plugin.run();

      const output = await plugin.postRun();

      for (const writtenFile of output.writtenFiles) {
        const { preExistingContent: _, wasWritten, ...rest } = writtenFile;

        if (wasWritten) {
          writtenPluginFiles.add(rest);
        }

        if (writtenFile.exportFromIndexFile !== false) {
          addFileToDirectory(path.dirname(writtenFile.writePath), writtenFile.writePath);
        }
      }
    }
  }

  if (config.generateIndexFiles) {
    for (const [directory, files] of builtFilesByDirectory.entries()) {
      const indexPath = path.join(directory, 'index.ts');
      const indexContent = [...files].reduce((indexFile, file) => {
        const baseName = path.basename(file, '.ts');
        const ext = path.extname(file);

        if (baseName !== 'index' && ['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(ext)) {
          return `${indexFile}export * from './${baseName}';\n`;
        }

        return indexFile;
      }, '');

      if (indexContent.trim().length > 0) {
        if (!config.dryRun) {
          fs.writeFileSync(indexPath, indexContent);
        }
      }
    }
  }

  logSuccess(`[jdef-ts-generator]: type generation complete in ${prettyMs(performance.now() - start)}`);
}

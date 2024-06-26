import { loadConfig } from './config';
import { getSource } from './get-source';
import { Generator } from './generate';
import fs from 'fs';
import path from 'path';

interface Args {
  cwd: string;
  args: string[];
}

export async function cli({ cwd, args }: Args) {
  const start = performance.now();

  const config = await loadConfig();

  const jdef = await getSource(config.jdefJsonSource);

  if (!jdef) {
    throw new Error('[jdef-ts-generator]: no valid jdef source found');
  }

  console.info('[jdef-ts-generator]: loaded jdef source, beginning type generation');

  const generator = new Generator(config);

  const { clientFile, typesFile } = generator.generate(jdef);
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
  fs.rmSync(typeOutputDir, { recursive: true, force: true });

  // Write generated file
  fs.mkdirSync(typeOutputDir, { recursive: true });
  fs.writeFileSync(typeOutputPath, typesFile);

  addFileToDirectory(typeOutputDir, typeOutputPath);

  console.info('[jdef-ts-generator]: interfaces and enums generated and saved to disk');

  if (config.clientOutput) {
    if (clientFile) {
      const clientOutputPath = path.join(
        cwd,
        config.clientOutput.directory,
        config.clientOutput.fileName || 'client.ts',
      );
      const clientOutputDir = path.dirname(clientOutputPath);

      // Clear output directory and recreate if it's not already been written to
      if (!builtFilesByDirectory.has(clientOutputDir)) {
        fs.rmSync(clientOutputDir, { recursive: true, force: true });
        fs.mkdirSync(clientOutputDir, { recursive: true });
      }

      // Write generated file
      fs.writeFileSync(clientOutputPath, clientFile);

      addFileToDirectory(clientOutputDir, clientOutputPath);

      console.info('[jdef-ts-generator]: api client generated and saved to disk');
    }
  }

  if (config.plugins) {
    for (const plugin of config.plugins) {
      plugin.prepare(cwd, jdef, generator);
      await plugin.run();
      const output = plugin.postRun();

      for (const writtenFile of output.writtenFiles) {
        addFileToDirectory(path.dirname(writtenFile.writtenTo), writtenFile.writtenTo);
      }
    }
  }

  if (config.generateIndexFiles) {
    for (const [directory, files] of builtFilesByDirectory.entries()) {
      const indexPath = path.join(directory, 'index.ts');
      const indexContent = [...files].reduce((indexFile, file) => {
        const baseName = path.basename(file, '.ts');

        if (baseName !== 'index') {
          return `${indexFile}export * from './${baseName}';\n`;
        }

        return baseName;
      }, '');

      if (indexContent.trim().length > 0) {
        fs.writeFileSync(indexPath, indexContent);
      }
    }
  }

  console.info(`[jdef-ts-generator]: type generation complete in ${performance.now() - start}ms`);
}

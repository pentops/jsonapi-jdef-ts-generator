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

  const jdef = await getSource(config.jdefJsonSource.path, config.jdefJsonSource.service);

  if (!jdef) {
    throw new Error('[jdef-ts-generator]: no valid jdef source found');
  }

  console.info('[jdef-ts-generator]: loaded jdef source, beginning type generation');

  const generator = new Generator(config);

  const { clientFile, typesFile } = generator.generate(jdef);

  // Clear output path
  fs.rmSync(path.join(cwd, config.typeOutput.directory), { recursive: true, force: true });

  // Write generated file
  const typeOutputPath = path.join(cwd, config.typeOutput.directory, config.typeOutput.fileName);
  fs.mkdirSync(path.dirname(typeOutputPath), { recursive: true });
  fs.writeFileSync(typeOutputPath, typesFile);

  console.info('[jdef-ts-generator]: interfaces and enums generated and saved to disk');

  if (config.clientOutput) {
    // Clear output path
    fs.rmSync(path.join(cwd, config.clientOutput.directory), { recursive: true, force: true });

    if (clientFile) {
      // Write generated file
      const clientOutputPath = path.join(
        cwd,
        config.clientOutput.directory,
        config.clientOutput.fileName || 'client.ts',
      );
      fs.mkdirSync(path.dirname(clientOutputPath), { recursive: true });
      fs.writeFileSync(clientOutputPath, clientFile);

      console.info('[jdef-ts-generator]: api client generated and saved to disk');
    }
  }

  console.info(`[jdef-ts-generator]: type generation complete in ${performance.now() - start}ms`);
}

import fs, { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import prettyMs from 'pretty-ms';
import { Project } from 'ts-morph';
import { SyntaxKind } from 'typescript';
import { loadConfig } from './config';
import { getSource } from './get-source';
import { Generator } from './generate';
import { logSuccess } from './internal/helpers';
import { WrittenFile } from './plugin/file/types';
import { GeneratedFunctionState, GeneratedSchemaState, State } from './state';
import { RenameCodemod } from './codemod/rename';
import { ICodemod } from './codemod/types';
import { FixUnusedSchemaIdentifiersCodemod } from './codemod/fix-unused-schema-identifiers';

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

  if (config.verbose) {
    console.info('[jdef-ts-generator]: loaded source, beginning type generation');
  }

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

    if (config.verbose) {
      logSuccess('[jdef-ts-generator]: interfaces and enums generated and saved to disk');
    }
  } else {
    console.info(`[jdef-ts-generator]: dry run enabled, file ${typeOutputPath} not written. Contents:\n${typesFile}`);
  }

  addFileToDirectory(typeOutputDir, typeOutputPath);

  const clientOutputPath = config.clientOutput
    ? path.join(cwd, config.clientOutput.directory, config.clientOutput.fileName || 'client.ts')
    : '';

  if (config.clientOutput && clientFile) {
    const clientOutputDir = path.dirname(clientOutputPath);

    // Clear output directory and recreate if it's not already been written to
    if (!config.dryRun && !builtFilesByDirectory.has(clientOutputDir)) {
      fs.rmSync(clientOutputDir, { recursive: true, force: true });
      fs.mkdirSync(clientOutputDir, { recursive: true });
    }

    if (!config.dryRun) {
      // Write generated file
      fs.writeFileSync(clientOutputPath, clientFile);

      if (config.verbose) {
        logSuccess('[jdef-ts-generator]: api client generated and saved to disk');
      }
    } else {
      console.info(
        `[jdef-ts-generator]: dry run enabled, file ${clientOutputPath} not written. Contents:\n${clientFile}`,
      );
    }

    addFileToDirectory(clientOutputDir, clientOutputPath);
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

  if (!config.state?.fileName) {
    return;
  }

  // Build generator state
  const state: State = {
    generatedSchemas: Array.from(generator.generatedSchemas.entries()).reduce<Record<string, GeneratedSchemaState>>(
      (acc, curr) => ({
        ...acc,
        [curr[0]]: {
          generatedSchemaName: curr[1].generatedName,
          writtenType: curr[1].node.kind,
          package: curr[1].parentPackage,
        },
      }),
      {},
    ),
    generatedClientFunctions: generator.generatedClientFunctions.reduce<Record<string, GeneratedFunctionState>>(
      (acc, curr) => ({
        ...acc,
        [curr.method.rawMethod.fullGrpcName]: {
          generatedFunctionName: curr.generatedName,
          writtenType: SyntaxKind.FunctionDeclaration,
          package: curr.method.parentPackage,
        },
      }),
      {},
    ),
    plugins: (config.plugins || []).reduce<Record<string, unknown>>((acc, curr) => {
      const pluginState = curr.getState();

      if (pluginState !== undefined) {
        acc[curr.name] = pluginState;
      }

      return acc;
    }, {}),
  };

  if (config.state.codemod.source && existsSync(config.state.fileName)) {
    let existingFile: string | undefined;

    try {
      existingFile = readFileSync(config.state.fileName, { encoding: 'utf-8' });
    } catch (err) {
      console.error(`[jdef-ts-generator]: unable to read state file: ${err}`);
    }

    try {
      if (existingFile) {
        const existingState = JSON.parse(existingFile) as State;

        const project = new Project();
        project.addSourceFilesAtPaths([typeOutputPath, clientOutputPath, ...builtFilesByDirectory.keys()]);

        if ('tsconfigPaths' in config.state.codemod.source) {
          for (const tsconfigPath of config.state.codemod.source.tsconfigPaths) {
            project.addSourceFilesFromTsConfig(tsconfigPath);
          }
        } else {
          project.addSourceFilesAtPaths(config.state.codemod.source.globs);
        }

        // Run codemods
        const generatorCodemods: ICodemod<any>[] = [];

        if (config.state.codemod.removeUnusedSchemas) {
          generatorCodemods.push(new FixUnusedSchemaIdentifiersCodemod(project));
        }

        if (config.state.codemod.rename) {
          generatorCodemods.push(new RenameCodemod(project));
        }

        generatorCodemods.forEach((codemod) => {
          codemod.process(existingState, state);
        });

        for (const plugin of config.plugins || []) {
          const codemod = plugin.getCodemod(project);

          if (codemod && existingState.plugins[plugin.name] !== undefined && state.plugins[plugin.name] !== undefined) {
            codemod.process(existingState.plugins[plugin.name], state.plugins[plugin.name]);
          }
        }

        await project.save();
      }
    } catch (e) {
      console.error(`[jdef-ts-generator]: unable to parse existing state file: ${e}`);
    }
  }

  // Write state file if it's not a dry run
  if (!config.dryRun) {
    try {
      writeFileSync(config.state.fileName, JSON.stringify(state, null, 2), { encoding: 'utf-8' });
    } catch (err) {
      console.error(`[jdef-ts-generator]: unable to write state file: ${err}`);
    }
  }

  logSuccess(`[jdef-ts-generator]: type generation complete in ${prettyMs(performance.now() - start)}`);
}

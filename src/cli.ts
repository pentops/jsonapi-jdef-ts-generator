import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'path';
import prettyMs from 'pretty-ms';
import { Project } from 'ts-morph';
import { SyntaxKind } from 'typescript';
import { loadConfig } from './config';
import { getSource } from './get-source';
import { Generator } from './generate';
import { logSuccess } from './internal/helpers';
import { GeneratedFunctionState, GeneratedSchemaState, State } from './state';
import { RenameCodemod } from './codemod/rename';
import { ICodemod } from './codemod/types';
import { FixUnusedSchemaIdentifiersCodemod } from './codemod/fix-unused-schema-identifiers';
import { IWritableFile } from './file/types';
import { createPluginEventBus, PluginEvent } from './plugin';

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
    await rm(typeOutputDir, { recursive: true, force: true });

    // Write generated file
    await mkdir(typeOutputDir, { recursive: true });
    await writeFile(typeOutputPath, typesFile);

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
      await rm(clientOutputDir, { recursive: true, force: true });
      await mkdir(clientOutputDir, { recursive: true });
    }

    if (!config.dryRun) {
      // Write generated file
      await writeFile(clientOutputPath, clientFile);

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
    const priorPluginFiles = new Set<IWritableFile<any, any>>();
    const directoriesToClear = new Set<string>();
    const filesToClear = new Set<string>();

    for (const plugin of config.plugins) {
      const pluginEventBus = createPluginEventBus<any>();

      if (plugin.pluginConfig.hooks) {
        for (const hook in plugin.pluginConfig.hooks) {
          const eventKey = hook as keyof PluginEvent<any>;
          (pluginEventBus.on as any)(eventKey, plugin.pluginConfig.hooks[eventKey]);
        }
      }

      plugin.prepare(cwd, api, generator, Array.from(priorPluginFiles), pluginEventBus);

      const res = await plugin.run();
      for (const file of res.files) {
        if (!config.dryRun) {
          if (file.clearDirectoryBeforeWrite) {
            directoriesToClear.add(path.dirname(file.writePath));
          } else {
            filesToClear.add(file.writePath);
          }
        }

        priorPluginFiles.add(file);
      }
    }

    if (!config.dryRun) {
      // Remove old files
      for (const directory of directoriesToClear) {
        try {
          await rm(directory, { recursive: true });
        } catch {}
      }

      for (const file of filesToClear) {
        try {
          await rm(file, { recursive: true, force: true });
        } catch {}
      }
    }

    // Write new files
    for (const file of priorPluginFiles) {
      file.writtenBy.eventBus?.emit('preWriteFile', { file });

      if (!config.dryRun) {
        await mkdir(path.dirname(file.writePath), { recursive: true });
        await writeFile(file.writePath, file.content);

        if (file.exportFromIndexFile !== false) {
          addFileToDirectory(path.dirname(file.writePath), file.writePath);
        }
      }

      file.writtenBy.eventBus?.emit('postWriteFile', { file });

      if (config.dryRun) {
        console.log(
          `[jdef-ts-generator]: dry run enabled, file from plugin ${file.writtenBy} (${file.writePath}) not written. Contents:\n${file.content}`,
        );
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
          await writeFile(indexPath, indexContent);
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
      existingFile = await readFile(config.state.fileName, { encoding: 'utf-8' });
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
      await writeFile(config.state.fileName, JSON.stringify(state, null, 2), { encoding: 'utf-8' });
    } catch (err) {
      console.error(`[jdef-ts-generator]: unable to write state file: ${err}`);
    }
  }

  logSuccess(`[jdef-ts-generator]: type generation complete in ${prettyMs(performance.now() - start)}`);
}

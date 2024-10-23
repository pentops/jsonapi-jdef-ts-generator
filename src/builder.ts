import path from 'path';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Project } from 'ts-morph';
import { Generator } from './generate';
import { logSuccess } from './internal/helpers';
import { IWritableFile } from './file/types';
import { createPluginEventBus, PluginEvent } from './plugin';
import { buildState, State } from './state';
import { ICodemod } from './codemod/types';
import { FixUnusedSchemaIdentifiersCodemod } from './codemod/fix-unused-schema-identifiers';
import { RenameCodemod } from './codemod/rename';
import { ParsedSource } from './parsed-types';
import { Config } from './config-types';

export class Builder {
  private readonly buildDir: string;
  private readonly source: ParsedSource;
  private readonly config: Config;

  constructor(buildDir: string, config: Config, source: ParsedSource) {
    this.buildDir = buildDir;
    this.config = config;
    this.source = source;
  }

  public async build(): Promise<Project | undefined> {
    if (this.config.verbose) {
      console.info('[jdef-ts-generator]: loaded source, beginning type generation');
    }

    const generator = new Generator(this.config);

    const { clientFile, typesFile } = generator.generate(this.source);
    const builtFilesByDirectory = new Map<string, Set<string>>();

    function addFileToDirectory(directory: string, fileName: string) {
      if (!builtFilesByDirectory.has(directory)) {
        builtFilesByDirectory.set(directory, new Set());
      }

      builtFilesByDirectory.get(directory)?.add(fileName);
    }

    // Clear types output path
    const typeOutputPath = path.join(this.buildDir, this.config.typeOutput.directory, this.config.typeOutput.fileName);
    const typeOutputDir = path.dirname(typeOutputPath);

    if (!this.config.dryRun) {
      await rm(typeOutputDir, { recursive: true, force: true });

      // Write generated file
      await mkdir(typeOutputDir, { recursive: true });
      await writeFile(typeOutputPath, typesFile);

      if (this.config.verbose) {
        logSuccess('[jdef-ts-generator]: interfaces and enums generated and saved to disk');
      }
    } else {
      console.info(`[jdef-ts-generator]: dry run enabled, file ${typeOutputPath} not written. Contents:\n${typesFile}`);
    }

    addFileToDirectory(typeOutputDir, typeOutputPath);

    const clientOutputPath = this.config.clientOutput
      ? path.join(this.buildDir, this.config.clientOutput.directory, this.config.clientOutput.fileName || 'client.ts')
      : '';

    if (this.config.clientOutput && clientFile) {
      const clientOutputDir = path.dirname(clientOutputPath);

      // Clear output directory and recreate if it's not already been written to
      if (!this.config.dryRun && !builtFilesByDirectory.has(clientOutputDir)) {
        await rm(clientOutputDir, { recursive: true, force: true });
        await mkdir(clientOutputDir, { recursive: true });
      }

      if (!this.config.dryRun) {
        // Write generated file
        await writeFile(clientOutputPath, clientFile);

        if (this.config.verbose) {
          logSuccess('[jdef-ts-generator]: api client generated and saved to disk');
        }
      } else {
        console.info(
          `[jdef-ts-generator]: dry run enabled, file ${clientOutputPath} not written. Contents:\n${clientFile}`,
        );
      }

      addFileToDirectory(clientOutputDir, clientOutputPath);
    }

    if (this.config.plugins) {
      const priorPluginFiles = new Set<IWritableFile<any, any>>();
      const directoriesToClear = new Set<string>();
      const filesToClear = new Set<string>();

      for (const plugin of this.config.plugins) {
        const pluginEventBus = createPluginEventBus<any>();

        if (plugin.pluginConfig.hooks) {
          for (const hook in plugin.pluginConfig.hooks) {
            const eventKey = hook as keyof PluginEvent<any>;
            (pluginEventBus.on as any)(eventKey, plugin.pluginConfig.hooks[eventKey]);
          }
        }

        plugin.prepare(this.buildDir, this.source, generator, Array.from(priorPluginFiles), pluginEventBus);

        const res = await plugin.run();
        for (const file of res.files) {
          if (!this.config.dryRun) {
            if (file.clearDirectoryBeforeWrite) {
              directoriesToClear.add(path.dirname(file.writePath));
            } else {
              filesToClear.add(file.writePath);
            }
          }

          priorPluginFiles.add(file);
        }
      }

      if (!this.config.dryRun) {
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

        if (!this.config.dryRun) {
          await mkdir(path.dirname(file.writePath), { recursive: true });
          await writeFile(file.writePath, file.content);
          file.wasWritten = true;

          if (file.exportFromIndexFile !== false) {
            addFileToDirectory(path.dirname(file.writePath), file.writePath);
          }
        }

        file.writtenBy.eventBus?.emit('postWriteFile', { file });

        if (this.config.dryRun) {
          console.log(
            `[jdef-ts-generator]: dry run enabled, file from plugin ${file.writtenBy} (${file.writePath}) not written. Contents:\n${file.content}`,
          );
        }
      }
    }

    if (this.config.generateIndexFiles) {
      for (const [directory, files] of builtFilesByDirectory.entries()) {
        const indexPath = path.join(directory, 'index.ts');
        const indexContent = [...files].reduce((indexFile, file) => {
          const baseName = path.basename(file, '.ts');
          const ext = path.extname(file);

          if (baseName !== 'index' && ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
            return `${indexFile}export * from './${baseName}';\n`;
          }

          return indexFile;
        }, '');

        if (indexContent.trim().length > 0) {
          if (!this.config.dryRun) {
            await writeFile(indexPath, indexContent);
          }
        }
      }
    }

    if (!this.config.state?.fileName) {
      return;
    }

    const project = new Project();
    project.addSourceFilesAtPaths([typeOutputPath, clientOutputPath, ...builtFilesByDirectory.keys()]);

    const state = buildState(generator.generatedSchemas, generator.generatedClientFunctions, this.config);

    if (this.config.state.codemod.source && existsSync(this.config.state.fileName)) {
      let existingFile: string | undefined;

      try {
        existingFile = await readFile(this.config.state.fileName, { encoding: 'utf-8' });
      } catch (err) {
        console.error(`[jdef-ts-generator]: unable to read state file: ${err}`);
      }

      try {
        if (existingFile) {
          const existingState = JSON.parse(existingFile) as State;

          const codemodProject = new Project();
          codemodProject.addSourceFilesAtPaths([typeOutputPath, clientOutputPath, ...builtFilesByDirectory.keys()]);

          if ('tsconfigPaths' in this.config.state.codemod.source) {
            for (const tsconfigPath of this.config.state.codemod.source.tsconfigPaths) {
              codemodProject.addSourceFilesFromTsConfig(tsconfigPath);
            }
          } else {
            codemodProject.addSourceFilesAtPaths(this.config.state.codemod.source.globs);
          }

          // Run codemods
          const generatorCodemods: ICodemod<any>[] = [];

          if (this.config.state.codemod.removeUnusedSchemas) {
            generatorCodemods.push(new FixUnusedSchemaIdentifiersCodemod(codemodProject));
          }

          if (this.config.state.codemod.rename) {
            generatorCodemods.push(new RenameCodemod(codemodProject));
          }

          generatorCodemods.forEach((codemod) => {
            codemod.process(existingState, state, existingState, state);
          });

          for (const plugin of this.config.plugins || []) {
            const codemod = plugin.getCodemod(codemodProject);

            if (
              codemod &&
              existingState.plugins[plugin.name] !== undefined &&
              state.plugins[plugin.name] !== undefined
            ) {
              codemod.process(existingState.plugins[plugin.name], state.plugins[plugin.name], existingState, state);
            }
          }

          await codemodProject.save();
        }
      } catch (e) {
        console.error(`[jdef-ts-generator]: unable to parse existing state file: ${e}`);
      }
    }

    // Write state file if it's not a dry run
    if (!this.config.dryRun) {
      try {
        await writeFile(this.config.state.fileName, JSON.stringify(state, null, 2), { encoding: 'utf-8' });
      } catch (err) {
        console.error(`[jdef-ts-generator]: unable to write state file: ${err}`);
      }
    }

    return project;
  }
}

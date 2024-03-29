import url from 'url';
import { findUp } from 'find-up';
import { camelCase } from 'change-case';
import { Method } from './jdef-types';

export interface HostedSource {
  // url is the url of the hosted jdef.json file
  url?: string;
  // auth is the authentication configuration for the hosted jdef.json file, if applicable
  auth?: {
    token?: string;
  };
}

interface TypeOutput {
  // fileName is the name of the generated types file
  fileName: `${string}.ts`;
  // directory is the directory where the generated types file will be saved
  directory: string;
  // importPath is the path that will be used to import the generated types file. If not specified, the import path will be relative to the current working directory.
  importPath?: string;
}

const defaultTypeOutput: TypeOutput = {
  fileName: 'index.ts',
  directory: './generated/types',
};

interface ClientOutput {
  // fileName is the name of the generated api client file
  fileName: `${string}.ts`;
  // directory is the directory where the generated api client file will be saved
  directory: string;
}

const defaultClientOutput: ClientOutput = {
  fileName: 'index.ts',
  directory: './generated/client',
};

interface TypeGenerationConfig {
  // enumType set to union will generate union types for enums (e.g., 'test' | 'test2'), enum will generate enum types (e.g., enum Test { test = 'test', test2 = 'test2' })
  enumType: 'union' | 'enum';
  // nameWriter is a function that takes the name of a schema and returns the name of the generated type. Can be used to change the naming/casing conventions of the generated interfaces/enums.
  nameWriter: (name: string) => string;
  // requestType set to merged means that the search parameters, path parameters, and request body will be merged into a single type. When set to split, the search parameters, path parameters, and request body will be split into separate types.
  requestType: 'merged' | 'split';
}

interface ClientGenerationConfig {
  // methodNameWriter is a function that takes a jdef method and returns the name of the generated method. Can be used to change the naming/casing conventions of the generated functions.
  methodNameWriter: (method: Method) => string;
}

export interface Config {
  typeOutput: TypeOutput;
  clientOutput?: ClientOutput;
  types: TypeGenerationConfig;
  client: ClientGenerationConfig;
  // jdefJsonSource is the source of the jdef.json file. Only one of service or path can be specified.
  jdefJsonSource: {
    service?: HostedSource;
    path?: string;
  };
}

export const defaultConfig: Config = {
  typeOutput: defaultTypeOutput,
  client: {
    methodNameWriter: (method: Method) => camelCase(method.fullGrpcName),
  },
  types: {
    enumType: 'enum',
    nameWriter: (x) =>
      x
        .split('.')
        .map((s) => s?.[0]?.toUpperCase() + s?.slice(1))
        .join(''),
    requestType: 'merged',
  },
  jdefJsonSource: {
    path: 'jdef.json',
  },
};

function mergeConfig(userSpecified: Partial<Config>): Config {
  const config: Config = { ...defaultConfig };

  if (userSpecified.typeOutput) {
    config.typeOutput = { ...config.typeOutput, ...userSpecified.typeOutput };
  }

  if (userSpecified.clientOutput) {
    config.clientOutput = { ...config.clientOutput, ...defaultClientOutput, ...userSpecified.clientOutput };
  }

  if (userSpecified.types) {
    config.types = { ...config.types, ...userSpecified.types };
  }

  if (userSpecified.client) {
    config.client = { ...config.client, ...userSpecified.client };
  }

  // JdefJsonSource is required, and only one can be specified
  if (userSpecified.jdefJsonSource) {
    config.jdefJsonSource = userSpecified.jdefJsonSource;
  }

  return config;
}

export async function loadConfig(): Promise<Config> {
  const configJs = await findUp('.jdef_config.js');

  if (configJs) {
    const configModule = await import(url.pathToFileURL(configJs).href);

    if (configModule?.default) {
      return mergeConfig(configModule.default);
    }
  }

  console.warn('[jdef-ts-generator]: no .jdef_config.js file found, using default config');

  return defaultConfig;
}

import fs from 'fs/promises';
import { match, P } from 'ts-pattern';
import { HostedSource, JSONSource, SourceType } from './config-types';
import { JDEF } from './jdef-types';
import { APISource } from './api-types';
import { ParsedSource } from './parsed-types';
import { parseApiSource, parseJdefSource } from './parse-sources';

function guessSourceType(path: string, explicitType: SourceType | undefined) {
  if (explicitType) {
    return explicitType;
  }

  if (path.toLowerCase().endsWith('api.json')) {
    return 'api';
  }

  if (path.toLowerCase().endsWith('jdef.json')) {
    return 'jdef';
  }

  throw new Error(
    `[jdef-ts-generator]: unable to determine source type from path: ${path}, please explicitly configure the source type (jdef or api)`,
  );
}

async function getLocalSource(filePath: string, explicitType: SourceType | undefined) {
  const sourceType = guessSourceType(filePath, explicitType);

  let fileContent: string;

  try {
    fileContent = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    throw new Error(
      `[jdef-ts-generator]: error encountered while reading custom ${sourceType}.json file at ${filePath}: ${err}`,
    );
  }

  if (fileContent) {
    try {
      const fileContentAsObject = JSON.parse(fileContent);

      return match(sourceType)
        .with('api', () => parseApiSource(fileContentAsObject as APISource))
        .with('jdef', () => parseJdefSource(fileContentAsObject as JDEF))
        .otherwise(() => undefined);
    } catch (e) {
      throw new Error(`[jdef-ts-generator]: error encountered while parsing custom ${sourceType}.json file: ${e}`);
    }
  }

  throw new Error(`[jdef-ts-generator]: no valid jdef file found at file path: ${filePath}`);
}

async function getHostedSource(hostedSource: HostedSource) {
  if (!hostedSource.url) {
    throw new Error(`[jdef-ts-generator]: no url provided for hosted jdef.json source`);
  }

  const sourceType = guessSourceType(hostedSource.url, hostedSource.type);

  const headers = new Headers({
    'Content-Type': 'application/json',
  });

  if (hostedSource.auth?.token) {
    headers.append('Authorization', `Bearer ${hostedSource.auth.token}`);
  }

  const result = await fetch(hostedSource.url, {
    method: 'GET',
    headers,
  });

  if (!result.ok) {
    console.error(
      `[jdef-ts-generator]: error fetching hosted source (${hostedSource.url}): [${result.status}] - ${result.statusText}`,
    );
    return undefined;
  }

  const json = await result.json();

  try {
    return match(sourceType)
      .with('api', () => parseApiSource(json as APISource))
      .with('jdef', () => parseJdefSource(json as JDEF))
      .otherwise(() => undefined);
  } catch (err) {
    // Add context, re-throw
    throw new Error(
      `[jdef-ts-generator]: error encountered while parsing hosted source json (${hostedSource.url}): ${err}`,
    );
  }
}

function mergeSources(sources: ParsedSource[]): ParsedSource {
  return sources.reduce<ParsedSource>(
    (acc, source) => {
      const { schemas, packages, metadata } = source;

      for (const [schemaName, value] of schemas) {
        if (!acc.schemas.has(schemaName)) {
          acc.schemas.set(schemaName, value);
        }
      }

      packages.forEach((pkg) => {
        const existingPackageIndex = acc.packages.findIndex((p) => p.name === pkg.name);

        if (existingPackageIndex === -1) {
          acc.packages.push(pkg);
        } else {
          pkg.services.forEach((service) => {
            const existingServiceIndex = acc.packages[existingPackageIndex].services.findIndex(
              (s) => s.name === service.name,
            );

            if (existingServiceIndex === -1) {
              acc.packages[existingPackageIndex].services.push(service);
            } else {
              service.methods.forEach((method) => {
                if (
                  !acc.packages[existingPackageIndex].services[existingServiceIndex].methods.some(
                    (m) => m.fullGrpcName === method.fullGrpcName,
                  )
                ) {
                  acc.packages[existingPackageIndex].services[existingServiceIndex].methods.push(method);
                }
              });
            }
          });
        }
      });

      if (acc.metadata.builtAt && metadata.builtAt && metadata.builtAt > acc.metadata.builtAt) {
        acc.metadata.builtAt = metadata.builtAt;
      }

      return acc;
    },
    {
      metadata: { builtAt: sources[0]?.metadata?.builtAt, version: sources[0]?.metadata?.version },
      schemas: new Map(),
      packages: [],
    },
  );
}

export async function getSource(src: JSONSource | JSONSource[]): Promise<ParsedSource> {
  if (!src) {
    throw new Error('[jdef-ts-generator]: no jdef.json source specified');
  }

  if (Array.isArray(src)) {
    const sources = await Promise.all(src.map((source) => getSource(source)));

    return mergeSources(sources);
  }

  const srcContent = await match(src)
    .with({ service: P.not(P.nullish) }, async ({ service }) => getHostedSource(service))
    .with({ path: P.not(P.nullish) }, async ({ path, type }) => getLocalSource(path, type))
    .otherwise(() => undefined);

  if (!srcContent) {
    throw new Error(
      `[jdef-ts-generator]: invalid source specified. Specify a hosted registry or a local filesystem path: ${src}`,
    );
  }

  return srcContent;
}

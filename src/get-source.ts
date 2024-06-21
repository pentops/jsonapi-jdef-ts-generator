import fs from 'fs/promises';
import { match, P } from 'ts-pattern';
import { HostedSource, JdefJsonSource } from './config';
import { API } from './jdef-types';

async function getLocalSource(filePath: string) {
  const fileContent = await fs.readFile(filePath, 'utf8');

  if (fileContent) {
    try {
      const fileContentAsObject = JSON.parse(fileContent);

      return fileContentAsObject as API;
    } catch (e) {
      throw new Error(`[jdef-ts-generator]: error encountered while parsing custom jdef.json file: ${e}`);
    }
  }

  throw new Error(`[jdef-ts-generator]: no valid jdef file found at file path: ${filePath}`);
}

async function getHostedSource(hostedSource: HostedSource) {
  if (!hostedSource.url) {
    throw new Error(`[jdef-ts-generator]: no url provided for hosted jdef.json source`);
  }

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

  const json = await result.json();

  return json as API;
}

function mergeSources(sources: API[]): API {
  return sources.reduce<API>(
    (acc, source) => {
      const { schemas, packages } = source;

      Object.entries(schemas).forEach(([key, value]) => {
        if (!acc.schemas[key]) {
          acc.schemas[key] = value;
        }
      });

      packages.forEach((pkg) => {
        const existingPackageIndex = acc.packages.findIndex((p) => p.name === pkg.name);

        if (existingPackageIndex === -1) {
          acc.packages.push(pkg);
        } else {
          pkg.methods.forEach((method) => {
            if (!acc.packages[existingPackageIndex].methods.some((m) => m.fullGrpcName === method.fullGrpcName)) {
              acc.packages[existingPackageIndex].methods.push(method);
            }
          });
        }
      });

      return acc;
    },
    { schemas: {}, packages: [] },
  );
}

export async function getSource(src: JdefJsonSource | JdefJsonSource[]): Promise<API> {
  if (!src) {
    throw new Error('[jdef-ts-generator]: no jdef.json source specified');
  }

  if (Array.isArray(src)) {
    const sources = await Promise.all(src.map((source) => getSource(source)));

    return mergeSources(sources);
  }

  const srcContent = await match(src)
    .with({ service: P.not(P.nullish) }, async ({ service }) => getHostedSource(service))
    .with({ path: P.not(P.nullish) }, async ({ path }) => getLocalSource(path))
    .otherwise(() => undefined);

  if (!srcContent) {
    throw new Error(
      `[jdef-ts-generator]: invalid jdef source specified. Specify a hosted registry or a local filesystem path: ${src}`,
    );
  }

  return srcContent;
}

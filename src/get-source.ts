import fs from 'fs/promises';
import { HostedSource } from './config';
import { API } from './jdef-types';

export async function getSource(filePath: string | undefined, hostedSource: HostedSource | undefined) {
  if (!filePath && !hostedSource) {
    throw new Error('[jdef-ts-generator]: no jdef.json source specified');
  }

  if (filePath) {
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

  if (hostedSource) {
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
}

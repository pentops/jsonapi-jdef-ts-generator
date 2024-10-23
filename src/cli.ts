import prettyMs from 'pretty-ms';
import { Builder } from './builder';
import { logSuccess } from './internal/helpers';
import { loadConfig } from './config';
import { getSource } from './get-source';

interface Args {
  cwd: string;
  args: string[];
}

export async function cli({ cwd, args }: Args) {
  const start = performance.now();

  const config = await loadConfig();

  const source = await getSource(config.jsonSource);

  if (!source) {
    throw new Error('[jdef-ts-generator]: no valid source found');
  }

  const builder = new Builder(cwd, config, source);

  await builder.build();

  logSuccess(`[jdef-ts-generator]: type generation complete in ${prettyMs(performance.now() - start)}`);
}

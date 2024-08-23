import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';

function getPlugins(resolveOnly) {
  const basePlugins = [typescript()];

  if (resolveOnly) {
    basePlugins.push(nodeResolve({ resolveOnly }));
  }

  return basePlugins;
}

export default [
  {
    input: 'src/index.ts',
    output: {
      dir: 'dist',
      format: 'es',
    },
    plugins: getPlugins(['change-case', 'ts-pattern', 'pretty-ms', 'parse-ms']),
  },
  {
    input: 'src/types.ts',
    output: {
      dir: 'dist',
      format: 'es',
    },
    plugins: getPlugins(),
  },
  {
    input: 'src/parse-sources.ts',
    output: {
      dir: 'dist',
      format: 'es',
    },
    plugins: getPlugins(['change-case', 'ts-pattern']),
  },
];

import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';

const plugins = [typescript(), nodeResolve({ resolveOnly: ['change-case', 'ts-pattern'] })];

export default [
  {
    input: 'src/index.ts',
    output: {
      dir: 'dist',
      format: 'es',
    },
    plugins,
  },
  {
    input: 'src/types.ts',
    output: {
      dir: 'dist',
      format: 'es',
    },
    plugins,
  },
  {
    input: 'src/parse-sources.ts',
    output: {
      dir: 'dist',
      format: 'es',
    },
    plugins,
  },
];

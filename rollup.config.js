import typescript from '@rollup/plugin-typescript';

const plugins = [typescript()];

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

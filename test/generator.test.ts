import { describe, it, expect } from 'vitest';
import { Generator } from '../src/generate';
import { defaultConfig } from '../src/config';
import { parseApiSource } from '../src/parse-sources';
import { APISource } from '../src/api-types';
import api from './api.json';

const parsed = parseApiSource(api as unknown as APISource);

// TODO: add snapshot tests when there's a stable input
describe(Generator, () => {
  it('should generate types from an api.json file', async () => {
    const generator = new Generator(defaultConfig);
    expect(generator.generate(parsed)).toMatchSnapshot();
  });

  it('should generate merged request parameter types from an api.json file when configured', async () => {
    const generator = new Generator({
      ...defaultConfig,
      types: { ...defaultConfig.types },
      clientOutput: { directory: 'client', fileName: 'client.ts' },
    });
    expect(generator.generate(parsed)).toMatchSnapshot();
  });
});

import { describe, it, expect } from 'vitest';
import { Generator } from '../src/generate';
import type { JDEF } from '../src/jdef-types';
import { defaultConfig } from '../src/config';
import { parseJdefSource } from '../src/parse-sources';
import jdef from './jdef.json';

const parsed = parseJdefSource(jdef as JDEF);

// TODO: add snapshot tests when there's a stable input
describe(Generator, () => {
  it('should generate types from a jdef.json file', async () => {
    const generator = new Generator(defaultConfig);
    expect(generator.generate(parsed)).toMatchSnapshot();
  });

  it('should generate split request parameter types from a jdef.json file when configured', async () => {
    const generator = new Generator({
      ...defaultConfig,
      types: { ...defaultConfig.types, requestType: 'split' },
      clientOutput: { directory: 'client', fileName: 'client.ts' },
    });
    expect(generator.generate(parsed)).toMatchSnapshot();
  });

  it('should generate merged request parameter types from a jdef.json file when configured', async () => {
    const generator = new Generator({
      ...defaultConfig,
      types: { ...defaultConfig.types, requestType: 'merged' },
      clientOutput: { directory: 'client', fileName: 'client.ts' },
    });
    expect(generator.generate(parsed)).toMatchSnapshot();
  });
});

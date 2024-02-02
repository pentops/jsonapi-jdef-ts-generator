import { describe, it, expect } from 'vitest';
import { Generator } from '../src/generate';
import type { API } from '../src/jdef-types';
import jdef from './jdef.json';
import { defaultConfig } from '../src/config';

// TODO: add snapshot tests when there's a stable input
describe(Generator, () => {
  it('should generate types from a jdef.json file', async () => {
    const generator = new Generator(defaultConfig);
    expect(generator.generate(jdef as API)).toMatchSnapshot();
  });

  it('should generate split request parameter types from a jdef.json file when configured', async () => {
    const generator = new Generator({
      ...defaultConfig,
      types: { ...defaultConfig.types, requestType: 'split' },
      clientOutput: { directory: 'client', fileName: 'client.ts' },
    });
    expect(generator.generate(jdef as API)).toMatchSnapshot();
  });

  it('should generate merged request parameter types from a jdef.json file when configured', async () => {
    const generator = new Generator({
      ...defaultConfig,
      types: { ...defaultConfig.types, requestType: 'merged' },
      clientOutput: { directory: 'client', fileName: 'client.ts' },
    });
    expect(generator.generate(jdef as API)).toMatchSnapshot();
  });
});

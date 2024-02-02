import { describe, it, expect } from 'vitest';
import { defaultConfig, loadConfig } from '../src/config';

describe(loadConfig, () => {
  it('should load the default config', async () => {
    const config = await loadConfig();
    expect(config).toEqual(defaultConfig);
  });
});

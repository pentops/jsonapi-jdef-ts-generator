import { cli } from './cli';

export * from './config';
export * from './generate';
export * from './plugin';
export * from './helpers';
export * from './jdef-types';

cli({ cwd: process.cwd(), args: process.argv });

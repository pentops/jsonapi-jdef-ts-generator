#! /usr/bin/env node
import { cli } from '../dist/index.js';

cli({ cwd: process.cwd(), args: process.argv });

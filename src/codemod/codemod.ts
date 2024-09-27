import { Project } from 'ts-morph';
import { ICodemod } from './types';

export abstract class Codemod<T = unknown> implements ICodemod<T> {
  protected project: Project;

  constructor(project: Project) {
    this.project = project;
  }

  process(oldState: T, newState: T): void {
    throw new Error(`Process not implemented for codemod ${this.constructor.name}`);
  }
}

import { Project } from 'ts-morph';
import { State } from '../state';
import { ICodemod } from './types';

export abstract class Codemod implements ICodemod {
  protected project: Project;

  constructor(project: Project) {
    this.project = project;
  }

  process(oldState: State, newState: State): void {
    throw new Error(`Prcoess not implemented for codemod ${this.constructor.name}`);
  }
}

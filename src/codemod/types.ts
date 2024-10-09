import { State } from '../state';

export interface ICodemod<T> {
  process(oldState: T, newState: T, oldProjectState: State, newProjectState: State): void;
}

import { State } from '../state';

export interface ICodemod<T> {
  process(
    oldState: T,
    newState: T,
    oldProjectState: Omit<State, 'plugins'>,
    newProjectState: Omit<State, 'plugins'>,
  ): void;
}

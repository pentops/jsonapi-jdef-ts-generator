import { State } from '../state';

export interface ICodemod {
  process(oldState: State, newState: State): void;
}

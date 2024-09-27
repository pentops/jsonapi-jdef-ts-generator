export interface ICodemod<T> {
  process(oldState: T, newState: T): void;
}

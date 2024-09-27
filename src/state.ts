import { SyntaxKind } from 'ts-morph';

export interface State {
  generatedSchemas: Record<string, { generatedSchemaName: string; writtenType: SyntaxKind }>;
  generatedClientFunctions: Record<
    string,
    { generatedFunctionName: string; writtenType: SyntaxKind.FunctionDeclaration }
  >;
}

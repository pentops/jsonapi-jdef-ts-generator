import { SyntaxKind } from 'typescript';
import type { PackageSummary } from './generated-types';

export interface GeneratedSchemaState {
  generatedSchemaName: string;
  writtenType: SyntaxKind;
  package?: PackageSummary;
}

export interface GeneratedFunctionState {
  generatedFunctionName: string;
  writtenType: SyntaxKind.FunctionDeclaration;
  package?: PackageSummary;
}

export interface State {
  generatedSchemas: Record<string, GeneratedSchemaState>;
  generatedClientFunctions: Record<string, GeneratedFunctionState>;
  plugins: Record<string, unknown>;
}

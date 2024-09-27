import ts from 'ts-morph';
import { Codemod } from './codemod';
import { State } from '../state';

export class RenameCodemod extends Codemod<State> {
  private getRenames(existingState: State, newState: State) {
    const renames: { oldName: string; newName: string; writtenType: ts.SyntaxKind }[] = [];

    for (const [fullGrpcName, existingSchema] of Object.entries(existingState.generatedSchemas)) {
      const newSchema = newState.generatedSchemas[fullGrpcName];

      if (
        existingSchema &&
        newSchema &&
        newSchema.generatedSchemaName !== existingSchema.generatedSchemaName &&
        newSchema.writtenType === existingSchema.writtenType
      ) {
        renames.push({
          oldName: existingSchema.generatedSchemaName,
          newName: newSchema.generatedSchemaName,
          writtenType: existingSchema.writtenType,
        });
      }
    }

    for (const [fullGrpcName, existingFunction] of Object.entries(existingState.generatedClientFunctions)) {
      const newFunction = newState.generatedClientFunctions[fullGrpcName];

      if (
        existingFunction &&
        newFunction &&
        newFunction.generatedFunctionName !== existingFunction.generatedFunctionName
      ) {
        renames.push({
          oldName: existingFunction.generatedFunctionName,
          newName: newFunction.generatedFunctionName,
          writtenType: existingFunction.writtenType,
        });
      }
    }

    return renames;
  }

  process(oldState: State, newState: State) {
    const renames = this.getRenames(oldState, newState);

    if (renames.length === 0) {
      return;
    }

    this.project.getSourceFiles().forEach((sourceFile) => {
      sourceFile.forEachDescendant((node) => {
        const nodeText = node.getText();

        switch (node.getKind()) {
          case ts.SyntaxKind.StringLiteral:
            for (const rename of renames) {
              if (nodeText === `'${rename.oldName}'`) {
                node.replaceWithText(`'${rename.newName}'`);
                break;
              } else if (nodeText === `"${rename.oldName}"`) {
                node.replaceWithText(`"${rename.newName}"`);
                break;
              } else if (nodeText === '`' + rename.oldName + '`') {
                node.replaceWithText('`' + rename.newName + '`');
                break;
              }
            }

            break;
          default:
            for (const rename of renames) {
              if (nodeText === rename.oldName) {
                node.replaceWithText(rename.newName);
                break;
              }
            }
        }
      });
    });
  }
}

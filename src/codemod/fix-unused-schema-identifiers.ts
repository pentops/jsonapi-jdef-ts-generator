import { Codemod } from './codemod';
import { State } from '../state';

export class FixUnusedSchemaIdentifiersCodemod extends Codemod<State> {
  process(_oldState: State, newState: State) {
    const schemaEntries = Object.entries(newState.generatedSchemas);

    this.project.getSourceFiles().forEach((sourceFile) => {
      for (const [schemaName, schema] of schemaEntries) {
        const foundSchema = sourceFile.getInterface(schema.generatedSchemaName);

        if (foundSchema && !foundSchema.findReferencesAsNodes()?.length) {
          foundSchema.remove();
          delete newState.generatedSchemas[schemaName];
        }
      }
    });
  }
}

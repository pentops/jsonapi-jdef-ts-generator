import { SyntaxKind } from 'typescript';
import type { GeneratedClientFunctionWithNodes, GeneratedSchemaWithNode, PackageSummary } from './generated-types';
import { sortByKey } from '@pentops/sort-helpers';
import { match, P } from 'ts-pattern';
import { Config } from './config-types';

export interface GeneratedSchemaState {
  generatedSchemaName: string;
  writtenType: SyntaxKind;
  package?: PackageSummary;
  enum?: Record<string, string>;
  oneOf?: string[];
}

export interface GeneratedFunctionState {
  generatedFunctionName: string;
  writtenType: SyntaxKind.FunctionDeclaration;
  package?: PackageSummary;
  filterableFields?: Record<string, string>;
  sortableFields?: Record<string, string>;
  searchableFields?: Record<string, string>;
}

export interface State {
  generatedSchemas: Record<string, GeneratedSchemaState>;
  generatedClientFunctions: Record<string, GeneratedFunctionState>;
  plugins: Record<string, unknown>;
}

export function buildState(
  generatedSchemas: Map<string, GeneratedSchemaWithNode>,
  generatedClientFunctions: GeneratedClientFunctionWithNodes[],
  config: Config,
): State {
  return {
    generatedSchemas: sortByKey(Array.from(generatedSchemas.entries()), (x) => x[0]).reduce<
      Record<string, GeneratedSchemaState>
    >(
      (acc, curr) => ({
        ...acc,
        [curr[0]]: {
          generatedSchemaName: curr[1].generatedName,
          writtenType: curr[1].node.kind,
          package: curr[1].parentPackage,
          enum: match(curr[1])
            .with(
              { generatedValueNames: P.not(P.nullish), rawSchema: { enum: { derivedHelperType: P.nullish } } },
              ({ generatedValueNames }) => Object.fromEntries(generatedValueNames.entries()),
            )
            .otherwise(() => undefined),
          oneOf: match(curr[1])
            .with(
              { generatedValueNames: P.not(P.nullish), rawSchema: { enum: { derivedHelperType: P.not(P.nullish) } } },
              ({ generatedValueNames }) => Array.from(generatedValueNames.keys()),
            )
            .otherwise(() => undefined),
        },
      }),
      {},
    ),
    generatedClientFunctions: sortByKey(generatedClientFunctions, (x) => x.method.rawMethod.fullGrpcName).reduce<
      Record<string, GeneratedFunctionState>
    >(
      (acc, curr) => ({
        ...acc,
        [curr.method.rawMethod.fullGrpcName]: {
          generatedFunctionName: curr.generatedName,
          writtenType: SyntaxKind.FunctionDeclaration,
          package: curr.method.parentPackage,
          filterableFields: match(curr.method.list)
            .with({ filterableFields: P.not(P.nullish) }, ({ filterableFields }) =>
              Object.fromEntries(filterableFields.generatedValueNames.entries()),
            )
            .otherwise(() => undefined),
          searchableFields: match(curr.method.list)
            .with({ searchableFields: P.not(P.nullish) }, ({ searchableFields }) =>
              Object.fromEntries(searchableFields.generatedValueNames.entries()),
            )
            .otherwise(() => undefined),
          sortableFields: match(curr.method.list)
            .with({ sortableFields: P.not(P.nullish) }, ({ sortableFields }) =>
              Object.fromEntries(sortableFields.generatedValueNames.entries()),
            )
            .otherwise(() => undefined),
        },
      }),
      {},
    ),
    plugins: sortByKey(config.plugins || [], ({ name }) => name).reduce<Record<string, unknown>>((acc, curr) => {
      const pluginState = curr.getState();

      if (pluginState !== undefined) {
        acc[curr.name] = pluginState;
      }

      return acc;
    }, {}),
  };
}

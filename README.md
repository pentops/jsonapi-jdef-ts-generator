# jsonapi-jdef-ts-generator

Generate types and API client functionality from a `jdef.json` file served by your [registry](https://github.com/pentops/registry).

## Getting Started

Install `@pentops/jsonapi-jdef-ts-generator` as a dev dependency and `@pentops/jsonapi-request` as a dependency (if you are going to use the generated API client).

### Configuration

Create a `.jdef_config.js` file in your project root. This file should default export a configuration object:

```js
const EXCLUDED_NAMESPACES = ['service', 'topic'];

export default {
  typeOutput: {
    fileName: 'index.ts',
    directory: './packages/types/generated',
    importPath: '@yourcompany/types',
  },
  clientOutput: {
    fileName: 'index.ts',
    directory: './packages/api-client/generated',
  },
  client: {
    // Remove the excluded namespaces from the method name and camelCase the result
    methodNameWriter: (method) =>
      method.fullGrpcName
        .split(/[./]/)
        .filter((s) => s && !EXCLUDED_NAMESPACES.includes(s.toLowerCase()))
        .map((s, i) => (i === 0 ? s : s[0].toUpperCase() + s.slice(1)))
        .join(''),
  },
  types: {
    enumType: 'enum',
    // Remove the excluded namespaces from the interface/enum name and camelCase the result
    nameWriter: (x) =>
      x
        .split('.')
        .filter((s) => s && !EXCLUDED_NAMESPACES.includes(s.toLowerCase()))
        .map((s) => s?.[0]?.toUpperCase() + s?.slice(1))
        .join(''),
    requestType: 'merged',
  },
  jsonSource: {
    path: 'jdef.json',
  },
};
```

#### Source Configuration

You can specify the source of the jdef.json or api.json file using the `jsonSource` property.

- The `path` property should be the path to a local `jdef.json` or `api.json` file.
- The `service` property should be set for a remote `jdef.json` or `api.json` file. It should be an object with the following properties:
  - `url`: The URL of the remote `jdef.json` or `api.json` file.
  - `auth`: An optional object containing a `token` if required.

See the [configuration definitions](./src/config.ts) for more information.

### Generating Types

Add a script to your `package.json` to run the generator.

```json
{
  "scripts": {
    "generate-types": "jdef-ts-generator"
  }
}
```

## Peer Dependencies

You will need to have `@pentops/jsonapi-request` installed as a dependency if you're going to use the generated API client.

import path from 'path';

export function getRelativePath(source: string, target: string) {
  const targetArr = target.split('/');
  const sourceArr = source.split('/');
  // Remove filename from end of source & target, discard source
  sourceArr.pop();
  const targetFileName = targetArr.pop();

  const relativePath = path.relative(sourceArr.join('/'), targetArr.join('/'));

  return (relativePath ? `${relativePath}/${targetFileName}` : `./${targetFileName}`).replaceAll(path.sep, '/');
}

export type ImportPathNameCleaner = (name: string) => string;

const defaultImportPathNameCleaner: ImportPathNameCleaner = (name) => {
  const fileExt = path.extname(name);

  let returnName = name;
  if (['.js', '.mjs', '.jsx', '.ts', '.tsx'].includes(fileExt)) {
    returnName = name.slice(0, -fileExt.length);
  }

  if (returnName.endsWith('/index')) {
    returnName = returnName.replace(/\/index$/, '');
  }

  return returnName;
};

export function getImportPath(
  toDir: string,
  toFileName: string,
  fromDir: string,
  fromFileName: string,
  pathNameCleaner: ImportPathNameCleaner = defaultImportPathNameCleaner,
) {
  let aPath = path.join(toDir, toFileName).replaceAll(path.sep, '/');
  let bPath = path.join(fromDir || './', fromFileName || 'index.ts').replaceAll(path.sep, '/');

  if (toDir.startsWith('./') && !aPath.startsWith('.')) {
    aPath = `./${aPath}`;
  }

  if (fromDir.startsWith('./') && !bPath.startsWith('.')) {
    bPath = `./${bPath}`;
  }

  let relativePath = pathNameCleaner(getRelativePath(bPath, aPath));

  if (!relativePath.startsWith('.')) {
    relativePath = `./${relativePath}`;
  }

  if (relativePath.endsWith('/')) {
    relativePath = relativePath.slice(0, -1);
  }

  return relativePath;
}

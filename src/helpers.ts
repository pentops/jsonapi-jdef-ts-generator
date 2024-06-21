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

export function getImportPath(toDir: string, toFileName: string, fromDir: string, fromFileName: string) {
  let aPath = path.join(toDir, toFileName).replaceAll(path.sep, '/');
  let bPath = path.join(fromDir || './', fromFileName || 'index.ts').replaceAll(path.sep, '/');

  if (toDir.startsWith('./') && !aPath.startsWith('.')) {
    aPath = `./${aPath}`;
  }

  if (fromDir.startsWith('./') && !bPath.startsWith('.')) {
    bPath = `./${bPath}`;
  }

  const relativePath = getRelativePath(bPath, aPath).replaceAll('index', '').replace(/\.ts$/, '');

  if (relativePath.endsWith('/')) {
    return relativePath.slice(0, -1);
  }

  return relativePath;
}

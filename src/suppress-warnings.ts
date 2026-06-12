// Must be imported before any module that loads node:sqlite.
// node:sqlite is stable for our use; hide the scary first-run ExperimentalWarning.
const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: any, ...rest: any[]) => {
  const text = typeof warning === 'string' ? warning : warning?.message ?? '';
  if (text.includes('SQLite is an experimental feature')) return;
  originalEmitWarning(warning, ...rest);
}) as typeof process.emitWarning;

export {};

// Some SDK ESM builds, such as @suilend/sdk, use extensionless relative imports that bundlers resolve but plain Node cannot.
// This loader retries failed resolutions with ".js" / "/index.js" and provides named-export shims for CJS lodash.
// Only used by validation scripts under scripts/.
import { fileURLToPath } from "node:url";

export async function load(url, context, nextLoad) {
  if (/\/node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?lodash\/lodash\.js$/.test(url)) {
    const path = fileURLToPath(url);
    return {
      format: "module",
      shortCircuit: true,
      source: `
        import { createRequire } from "node:module";
        const _ = createRequire(import.meta.url)(${JSON.stringify(path)});
        export default _;
        export const { chunk, cloneDeep } = _;
      `,
    };
  }
  return nextLoad(url, context);
}
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const retriable = error?.code === "ERR_MODULE_NOT_FOUND" || error?.code === "ERR_UNSUPPORTED_DIR_IMPORT";
    if (retriable && (specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../"))) {
      const base = specifier.replace(/\/+$/, "");
      for (const candidate of [`${base}.js`, `${base}.ts`, `${base}/index.js`]) {
        try {
          return await nextResolve(candidate, context);
        } catch {
          // Try the next candidate
        }
      }
    }
    throw error;
  }
}

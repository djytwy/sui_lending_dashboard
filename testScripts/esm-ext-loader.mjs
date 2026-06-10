// 部分 SDK（如 @suilend/sdk）的 ESM 产物使用无扩展名相对导入，打包器能解析但纯 Node 不行。
// 该 loader 在解析失败时补 ".js" / "/index.js" 再试；并为 CJS 的 lodash 提供命名导出 shim。
// 仅供 scripts/ 下的验证脚本使用。
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
          // 尝试下一个候选
        }
      }
    }
    throw error;
  }
}

import { register } from "node:module";

register(new URL("./esm-ext-loader.mjs", import.meta.url));

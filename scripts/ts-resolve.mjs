// For `npm test`: resolves what Next understands and Node doesn't, so tests run on the real source.
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SRC = path.join(process.cwd(), "src");

registerHooks({
  resolve(spec, ctx, next) {
    // Marks code as server-only for the bundler. Tests are server code.
    if (spec === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
    if (/^next\/[a-z]+$/.test(spec)) return next(`${spec}.js`, ctx);
    if (spec.startsWith("@/")) spec = pathToFileURL(path.join(SRC, spec.slice(2))).href;
    if ((spec.startsWith(".") || spec.startsWith("file:")) && ctx.parentURL?.endsWith(".ts") && !path.extname(spec)) return next(`${spec}.ts`, ctx);
    return next(spec, ctx);
  },
});

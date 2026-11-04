// For `npm test`: the app imports "./types" without an extension, which Next understands and Node doesn't.
import { registerHooks } from "node:module";
import path from "node:path";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && ctx.parentURL?.endsWith(".ts") && !path.extname(spec)) return next(`${spec}.ts`, ctx);
    return next(spec, ctx);
  },
});

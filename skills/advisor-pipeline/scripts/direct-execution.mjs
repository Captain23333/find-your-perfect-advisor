import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function canonicalPath(path) {
  const absolutePath = resolve(path);
  try {
    return realpathSync(absolutePath);
  } catch {
    return absolutePath;
  }
}

// Node resolves the main module's real path, while process.argv[1] can retain a
// symlink such as macOS /tmp -> /private/tmp. Compare canonical filesystem
// paths so direct CLI execution cannot silently turn into a no-op.
export function isExecutedDirectly(importMetaUrl, argvPath = process.argv[1]) {
  if (!argvPath) return false;
  return canonicalPath(fileURLToPath(importMetaUrl)) === canonicalPath(argvPath);
}

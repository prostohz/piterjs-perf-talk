import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

export type Manifest = Record<string, string>;

export async function manifest(
  root: string,
  skipRuntime = false,
): Promise<Manifest> {
  const result: Manifest = Object.create(null) as Manifest;
  async function walk(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (skipRuntime && [".git", "node_modules"].includes(entry.name))
        continue;
      const full = join(path, entry.name);
      const key = relative(root, full);
      if (entry.isSymbolicLink())
        throw new Error(
          `Symlinks are not supported in source snapshots: ${key}`,
        );
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile())
        result[key] = createHash("sha256")
          .update(String((await lstat(full)).mode & 0o777))
          .update(await readFile(full))
          .digest("hex");
      else throw new Error(`Unsupported file: ${key}`);
    }
  }
  await walk(root);
  return result;
}

export function assertAllowedChanges(before: Manifest, after: Manifest): void {
  const sourceExtension = /\.(?:[cm]?[jt]sx?|css|scss|sass|less|vue|svelte)$/i;
  const protectedName =
    /(?:^|[/.\-_])(?:test|tests|spec|specs|__tests__|__snapshots__|fixtures?|mocks?|config|configs|setup|jest|vitest|playwright|karma|mocha|ava|coverage)(?:[/.\-_]|$)/i;
  const violations = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].filter(
    (path) =>
      before[path] !== after[path] &&
      (!sourceExtension.test(path) ||
        protectedName.test(path) ||
        /(?:^|\/)(?:scripts|\.github|\.husky|\.yarn|\.pnpm)(?:\/|$)/.test(
          path,
        )),
  );
  if (violations.length)
    throw new Error(`Protected files changed: ${violations.join(", ")}`);
}

export function assertUnchanged(
  before: Manifest,
  after: Manifest,
  label: string,
): void {
  if (
    JSON.stringify(Object.entries(before).sort()) !==
    JSON.stringify(Object.entries(after).sort())
  )
    throw new Error(`${label} changed during the run`);
}

export async function fixedFilesIntegrity(
  root: string,
): Promise<() => Promise<void>> {
  const initial = await manifest(root, true);
  const library = await manifest(join(root, "library"), true);
  return async () => {
    const after = await manifest(root, true);
    const existing: Manifest = Object.create(null) as Manifest;
    for (const key of Object.keys(initial))
      if (Object.hasOwn(after, key)) existing[key] = after[key]!;
    assertUnchanged(initial, existing, "Target source");
    assertUnchanged(
      library,
      await manifest(join(root, "library"), true),
      "Original library",
    );
  };
}

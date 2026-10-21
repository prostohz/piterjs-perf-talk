import { cp, lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { manifest } from "./integrity.js";

const exec = promisify(execFile);

export async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function copyLibrary(
  source: string,
  destination: string,
): Promise<void> {
  const { stdout: status } = await exec("git", [
    "-C",
    source,
    "status",
    "--porcelain",
  ]);
  if (status.trim())
    throw new Error("Source library must have a clean Git working tree");
  const { stdout: files } = await exec(
    "git",
    ["-C", source, "ls-files", "-z"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const paths = files.split("\0").filter(Boolean);
  if (!paths.length) throw new Error("Source library has no tracked files");
  await mkdir(destination, { recursive: true });
  for (const path of paths) {
    const from = resolve(source, path);
    if (
      !from.startsWith(`${resolve(source)}/`) ||
      !(await lstat(from)).isFile()
    )
      throw new Error(`Unsupported source entry: ${path}`);
    const to = join(destination, path);
    await mkdir(dirname(to), { recursive: true });
    await cp(from, to);
  }
}

export async function copySnapshot(
  source: string,
  destination: string,
): Promise<void> {
  await manifest(source);
  await cp(source, destination, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
}

export interface SnapshotPaths {
  directory: string;
  library: string;
  backup: string;
  pending: string;
  restored: string;
}

export function snapshotPaths(runDirectory: string, id: string): SnapshotPaths {
  const directory = join(runDirectory, id);
  return {
    directory,
    library: join(directory, "library"),
    backup: join(directory, ".source"),
    pending: join(directory, ".source-pending"),
    restored: join(directory, ".source-restored"),
  };
}

export async function preserveSource(paths: SnapshotPaths): Promise<void> {
  await copySnapshot(paths.library, paths.pending);
  await rename(paths.pending, paths.backup);
}

export async function restoreSource(paths: SnapshotPaths): Promise<void> {
  if (!(await exists(paths.backup))) return;

  await mkdir(paths.library, { recursive: true });
  for (const entry of await readdir(paths.library)) {
    await rm(join(paths.library, entry), { recursive: true, force: true });
  }
  await cp(paths.backup, paths.library, { recursive: true });
  await rename(paths.backup, paths.restored);
  await rm(paths.restored, { recursive: true, force: true });
}

export async function cleanupSnapshot(paths: SnapshotPaths): Promise<void> {
  await restoreSource(paths);
  for (const path of [paths.pending, paths.restored]) {
    await rm(path, { recursive: true, force: true });
  }
}

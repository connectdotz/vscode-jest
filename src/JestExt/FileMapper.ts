import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { SrcTestFileMapping } from './types';

/**
 * Class that manages mapping and navigation from source files to their corresponding test files.
 * Primary consumer is the "Go to Test File" command.
 */

interface ResolvedMapping extends SrcTestFileMapping {
  absSrcRoot: string;
  absTestRoot: string;
}

export class FileMapper {
  private readonly resolved: readonly ResolvedMapping[];

  // Cache for src -> test file candidates
  private srcToTestsCache: Map<string, string[] | undefined> = new Map();
  private testToSrcCache: Map<string, string | undefined> = new Map();

  constructor(
    workspaceFolder: vscode.WorkspaceFolder,
    mappings: readonly SrcTestFileMapping[],
    rootPath?: string
  ) {
    const projectRoot = rootPath
      ? path.join(workspaceFolder.uri.fsPath, rootPath)
      : workspaceFolder.uri.fsPath;

    this.resolved = mappings.map((m) => ({
      ...m,
      absSrcRoot: path.join(projectRoot, m.srcRoot),
      absTestRoot: m.testRootAtSrc
        ? '' // not applicable for sibling layout
        : path.join(projectRoot, m.testRoot),
    }));
  }

  /**
   * Checks if a file path is located within or is identical to a specified directory path.
   * Assumes inputs are intended as absolute paths, but resolves them for robustness
   * against non-normalized paths (e.g., containing '..', '//').
   * Handles path normalization, separators, and case-insensitivity on Windows.
   *
   * @param absoluteFilePath The file or directory path to check (absolute).
   * @param absoluteDirPath The directory path to check against (absolute).
   * @returns True if filePath is identical to or within the directory, false otherwise.
   */
  private isWithin(absoluteFilePath: string, absoluteDirPath: string): boolean {
    if (!absoluteFilePath || !absoluteDirPath) {
      return false; // Or throw an error if preferred for invalid input
    }

    // Calculate the relative path FROM the directory TO the file
    const relativePath = path.relative(absoluteDirPath, absoluteFilePath);

    // Check if file path is the same or deeper than the directory path
    // It's within if relativePath is empty ('') OR
    // if it's not empty, doesn't start with '..', and isn't itself an absolute path
    // (the last check handles Windows cross-drive comparisons).
    return (
      relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
    );
  }

  /**
   * Find the start index of `needle` in `hay`, or -1 if not found.
   */
  private findSubDirIndex(aPath: string, subDir: string): number {
    const pathParts = path.normalize(aPath).split(path.sep);
    const subDirParts = path.normalize(subDir).split(path.sep).filter(Boolean);
    return pathParts.findIndex(
      (_, i, arr) =>
        i + subDirParts.length <= arr.length && subDirParts.every((seg, j) => arr[i + j] === seg)
    );
  }

  /**
   * Determine whether a given path matches the configured **test pattern**.
   *
   * @param absFile   Absolute file path to check.
   * @param strict If **true** (default), the path must satisfy **both** criteria:
   *               1. stem ends with the configured `testSuffix` **and**
   *               2. path is located under the expected `testRoot`.
   *               If **false**, the method is looser: it returns `true` when *either*
   *               the suffix matches **or** the path sits under the `testRoot`.
   */
  private matchTestPattern(absFile: string, strict = true): boolean {
    const { name: stem, dir } = path.parse(absFile);

    return this.resolved.some((m) => {
      const suffixMatch = stem.endsWith(m.testSuffix);

      let rootMatch: boolean;
      if (m.testRootAtSrc) {
        // ----- sibling layout -----
        // Make dir relative to the src‑root so we can ignore the part above it
        const relDir = path.relative(m.absSrcRoot, dir);

        rootMatch = this.findSubDirIndex(relDir, m.testRoot) >= 0;
      } else {
        // ----- centralized layout -----
        rootMatch = this.isWithin(absFile, m.absTestRoot);
      }

      return strict ? suffixMatch && rootMatch : suffixMatch || rootMatch;
    });
  }

  /**
   * Retrieves all possible test file paths for a given source file.
   * Supports both common patterns:
   * - Tests in a parallel directory structure
   * - Tests in a __tests__ subdirectory within the source tree
   *
   * @param srcFile Absolute or relative path to the source file.
   * @returns Array of candidate test file paths (they may or may not exist on disk).
   */
  getTestFiles(srcFile: string): string[] | undefined {
    const absSrcFile = path.resolve(srcFile);

    if (this.srcToTestsCache.has(absSrcFile)) return this.srcToTestsCache.get(absSrcFile);

    let results: string[] | undefined;

    if (!this.matchTestPattern(absSrcFile, false)) {
      const mappings = this.resolved.filter((m) => this.isWithin(absSrcFile, m.absSrcRoot));
      mappings.forEach((mapping) => {
        const { dir: srcDir, name: baseName, ext } = path.parse(absSrcFile);
        const relPathInsideSrc = path.relative(mapping.absSrcRoot, absSrcFile);
        const relDirInsideSrc = path.dirname(relPathInsideSrc);

        const testDir = mapping.testRootAtSrc
          ? path.join(srcDir, mapping.testRoot)
          : path.join(mapping.absTestRoot, relDirInsideSrc);

        if (!results) {
          results = [];
        }
        results.push(path.join(testDir, `${baseName}${mapping.testSuffix}${ext}`));
      });
    }

    // cache even the undefined outcome to avoid re‑work
    this.srcToTestsCache.set(absSrcFile, results);
    return results;
  }

  /** Map *test* file → source file (first match) */
  getSourceFile(testFile: string): string | undefined {
    const absTestFile = path.resolve(testFile);

    if (this.testToSrcCache.has(absTestFile)) return this.testToSrcCache.get(absTestFile);

    if (!this.matchTestPattern(absTestFile)) {
      this.testToSrcCache.set(absTestFile, undefined);
      return;
    }

    const { name: stem, ext } = path.parse(absTestFile);

    let srcFile: string | undefined;
    for (const m of this.resolved) {
      if (!m.testRootAtSrc) {
        // check path under the testRoot
        if (!this.isWithin(absTestFile, m.absTestRoot)) continue;

        // construct the source file name
        const rel = path.relative(m.absTestRoot, absTestFile);
        const dir = path.dirname(rel);
        const base = stem.slice(0, -m.testSuffix.length);
        srcFile = path.join(m.absSrcRoot, dir, `${base}${ext}`);
      } else {
        // check path under the srcRoot
        if (!this.isWithin(absTestFile, m.absSrcRoot)) continue;

        // check if testRoot is in the path
        const idx = this.findSubDirIndex(absTestFile, m.testRoot);
        if (idx < 1) continue;

        // construct the source file name
        const parts = absTestFile.split(path.sep);
        const base = stem.slice(0, -m.testSuffix.length);
        const srcDir = parts.slice(0, idx).join(path.sep);
        srcFile = path.join(srcDir, `${base}${ext}`);
      }
      if (srcFile) break;
    }

    // cache even the undefined outcome to avoid re‑work
    this.testToSrcCache.set(absTestFile, srcFile);
    return srcFile;
  }

  /**
   * Opens the test file for a given source file.
   * Presents all possible test file candidates and checks for existence
   * only after user selection.
   *
   * @param srcFile - The path to the source file.
   */
  async openTestFileFor(srcFile: string) {
    const candidates = this.getTestFiles(srcFile);

    if (!candidates || candidates.length === 0) {
      return vscode.window.showErrorMessage(`No test file matched for: ${srcFile}`);
    }

    // If there's only one candidate, just try to open/create it
    if (candidates.length === 1) {
      return this.openFile(candidates[0]);
    }

    // Let the user pick from all possible candidates
    const pick = await vscode.window.showQuickPick(candidates, {
      title: 'Select test file',
      placeHolder: 'Choose a test file location',
    });

    if (pick) {
      return this.openFile(pick);
    }
  }

  /**
   * Opens the source file for a given test file.
   * Presents all possible test file candidates and checks for existence
   * only after user selection.
   *
   * @param testFile - The path to the test file.
   */
  async openSourceFileFor(testFile: string) {
    const candidate = this.getSourceFile(testFile);

    if (!candidate) {
      return vscode.window.showErrorMessage(`No source file matched for: ${testFile}`);
    }

    return this.openFile(candidate);
  }

  /**
   * Opens a file in the editor.
   * If the file doesn't exist and createIfNeeded is true, prompts the user to create it.
   *
   * @param file - The file path to open
   */
  private async openFile(file: string) {
    const isExist = fs.existsSync(file);
    let uri = vscode.Uri.file(file);

    if (!isExist) {
      // If the file doesn't exist, prompt the user to create it
      const confirm = await vscode.window.showInformationMessage(
        `File does not exist: ${file}`,
        'Create and Open',
        'Cancel'
      );

      if (confirm !== 'Create and Open') {
        return;
      }

      try {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(file)));
        // make it an untitled file
        uri = uri.with({ scheme: 'untitled' });
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to create directory: ${JSON.stringify(err)}`);
        return;
      }
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
  }
}

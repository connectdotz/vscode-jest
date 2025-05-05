import { JestTotalResults, ProjectWorkspace } from 'jest-editor-support';

import * as vscode from 'vscode';
import { LoggingFactory } from '../logging';
import { PluginResourceSettings } from '../Settings';
import { ProcessSession } from './process-session';
import { JestProcessInfo } from '../JestProcessManagement';
import { JestOutputTerminal } from './output-terminal';
import { TestIdentifier } from '../TestResults';
import { DebugInfo } from '../types';

export enum WatchMode {
  None = 'none',
  Watch = 'watch',
  WatchAll = 'watchAll',
}
export interface RunnerWorkspaceOptions {
  outputFileSuffix?: string;
  collectCoverage?: boolean;
}
export interface JestExtContext {
  settings: PluginResourceSettings;
  workspace: vscode.WorkspaceFolder;
  loggingFactory: LoggingFactory;
  createRunnerWorkspace: (options?: RunnerWorkspaceOptions) => ProjectWorkspace;
  output: JestOutputTerminal;
}

export interface JestExtSessionContext extends JestExtContext {
  session: ProcessSession;
}
export interface RunEventBase {
  process: JestProcessInfo;
}
export type JestRunEvent = RunEventBase &
  (
    | { type: 'scheduled' }
    | { type: 'data'; text: string; raw?: string; newLine?: boolean; isError?: boolean }
    | { type: 'test-error' }
    | { type: 'process-start' }
    | { type: 'start' }
    | { type: 'end'; error?: string }
    | { type: 'exit'; error?: string; code?: number }
    | { type: 'long-run'; threshold: number; numTotalTestSuites?: number }
  );

export interface JestTestDataAvailableEvent {
  data: JestTotalResults;
  process: JestProcessInfo;
}
export interface JestSessionEvents {
  onRunEvent: vscode.EventEmitter<JestRunEvent>;
  onTestSessionStarted: vscode.EventEmitter<JestExtSessionContext>;
  onTestSessionStopped: vscode.EventEmitter<void>;
  onTestDataAvailable: vscode.EventEmitter<JestTestDataAvailableEvent>;
}
export interface JestExtProcessContextRaw extends JestExtContext {
  updateWithData: (data: JestTotalResults, process: JestProcessInfo) => void;
  onRunEvent: vscode.EventEmitter<JestRunEvent>;
}
export type JestExtProcessContext = Readonly<JestExtProcessContextRaw>;

export type DebugTestIdentifier = string | TestIdentifier;

export type DebugFunction = (debugInfo: DebugInfo) => Promise<void>;

/**
 * Defines a rule for mapping source files to their corresponding test files.
 *
 * Each mapping specifies where the source code is located, where to find its tests,
 * and how to recognize a test file based on its suffix.
 *
 * Example mappings:
 *
 * - Centralized tests:
 *   {
 *     srcRoot: "src",
 *     testRoot: "tests",
 *     testSuffix: ".test"
 *   }
 *
 * - Sibling tests:
 *   {
 *     srcRoot: "src",
 *     testRoot: "__tests__",
 *     testSuffix: ".spec",
 *     testRootRelativeToSrcFile: true
 *   }
 */
export interface SrcTestFileMapping {
  /**
   * The source root directory relative to the workspace folder.
   * This typically contains the application's source code.
   *
   * Example: "src" or "packages/client/src".
   */
  srcRoot: string;

  /**
   * The root directory where corresponding test files are located.
   * Either relative to the workspace folder or the source file, depending on `testRootRelativeToSrcFile`.
   *
   * Example: "__tests__" or "tests".
   */
  testRoot: string;

  /**
   * The suffix string used to identify a test file, excluding the file extension.
   *
   * Example: ".test" for files like "app.test.ts".
   */
  testSuffix: string;

  /**
   * Optional flag indicating whether `testRoot` should be resolved relative to the source file location.
   *
   * - `true`: `testRoot` is relative to each source file's directory (e.g., sibling "__tests__" folders).
   * - `false` or omitted: `testRoot` is relative to the workspace folder + `srcRoot`.
   */
  testRootAtSrc?: boolean;
}

import * as vscode from 'vscode';
import { TestResult } from './TestResult';

export interface MatchEventData {
  fileName: string;
  results: TestResult[];
}
export type TestSuiteChangeReason = 'assertions-updated' | 'result-matched';
export interface TestSuitChangeEvent {
  files: string[];
  reason: TestSuiteChangeReason;
}
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export const createTestResultEvents = () => ({
  testListUpdated: new vscode.EventEmitter<string[] | undefined>(),
  testSuiteChanged: new vscode.EventEmitter<TestSuitChangeEvent>(),
});
export type TestResultEvents = ReturnType<typeof createTestResultEvents>;

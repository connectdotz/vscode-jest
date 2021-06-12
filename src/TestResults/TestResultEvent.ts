import * as vscode from 'vscode';
import { TestFileAssertionStatus } from '../../../jest-editor-support';
import { TestResult } from './TestResult';

export interface MatchEventData {
  fileName: string;
  results: TestResult[];
}
export const createTestResultEvents = () =>
  ({
    testListUpdated: new vscode.EventEmitter<string[] | undefined>(),
    testAssertionUpdated: new vscode.EventEmitter<TestFileAssertionStatus[]>(),
    testResultMatched: new vscode.EventEmitter<MatchEventData>(),
  } as const);
export type TestResultEvents = ReturnType<typeof createTestResultEvents>;

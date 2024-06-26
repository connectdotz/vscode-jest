import {
  JestFileResults,
  JestTotalResults,
  CodeLocation as Location,
  TestReconciliationState,
} from 'jest-editor-support';
import { CoverageMapData, FileCoverageData } from 'istanbul-lib-coverage';
import * as path from 'path';
import { cleanAnsi, toLowerCaseDriveLetter } from '../helpers';
import { MatchEvent } from './match-node';

export interface LocationRange {
  start: Location;
  end: Location;
}

export interface TestIdentifier {
  title: string;
  ancestorTitles: string[];
}

export interface TestResult extends LocationRange {
  name: string;

  identifier: TestIdentifier;

  status: TestReconciliationState;
  shortMessage?: string;
  terseMessage?: string;

  /** Zero-based line number */
  lineNumberOfError?: number;

  // multiple results for the given range, common for parameterized (.each) tests
  multiResults?: TestResult[];

  // matching process history
  sourceHistory?: MatchEvent[];
  assertionHistory?: MatchEvent[];
}

function testResultWithLowerCaseWindowsDriveLetter(testResult: JestFileResults): JestFileResults {
  const newFilePath = toLowerCaseDriveLetter(testResult.name);
  if (newFilePath) {
    return {
      ...testResult,
      name: newFilePath,
    };
  }

  return testResult;
}

export const testResultsWithLowerCaseWindowsDriveLetters = (
  testResults: JestFileResults[]
): JestFileResults[] => {
  if (!testResults) {
    return testResults;
  }

  return testResults.map(testResultWithLowerCaseWindowsDriveLetter);
};

function fileCoverageWithLowerCaseWindowsDriveLetter(
  fileCoverage: FileCoverageData
): FileCoverageData {
  const newFilePath = toLowerCaseDriveLetter(fileCoverage.path);
  if (newFilePath) {
    return {
      ...fileCoverage,
      path: newFilePath,
    };
  }

  return fileCoverage;
}

export const coverageMapWithLowerCaseWindowsDriveLetters = (
  data: JestTotalResults
): CoverageMapData | undefined => {
  if (!data.coverageMap) {
    return;
  }

  const result: CoverageMapData = {};
  const filePaths = Object.keys(data.coverageMap);

  for (const filePath of filePaths) {
    const newFileCoverage = fileCoverageWithLowerCaseWindowsDriveLetter(data.coverageMap[filePath]);
    result[newFileCoverage.path] = newFileCoverage;
  }

  return result;
};

/**
 * Normalize file paths on Windows systems to use lowercase drive letters.
 * This follows the standard used by Visual Studio Code for URIs which includes
 * the document fileName property.
 *
 * @param data Parsed JSON results
 */
export const resultsWithLowerCaseWindowsDriveLetters = (
  data: JestTotalResults
): JestTotalResults => {
  if (path.sep === '\\') {
    return {
      ...data,
      coverageMap: coverageMapWithLowerCaseWindowsDriveLetters(data),
      testResults: testResultsWithLowerCaseWindowsDriveLetters(data.testResults),
    };
  }

  return data;
};

/**
 * Removes ANSI escape sequence characters from test results in order to get clean messages
 */
export const resultsWithoutAnsiEscapeSequence = (data: JestTotalResults): JestTotalResults => {
  if (!data || !data.testResults) {
    return data;
  }

  return {
    ...data,
    testResults: data.testResults.map((result) => ({
      ...result,
      message: cleanAnsi(result.message),
      assertionResults: result.assertionResults.map((assertion) => ({
        ...assertion,
        failureMessages: (assertion.failureMessages ?? []).map((message) => cleanAnsi(message)),
      })),
    })),
  };
};

// enum based on TestReconciliationState
export const TestStatus: {
  [key in TestReconciliationState]: TestReconciliationState;
} = {
  Unknown: 'Unknown',
  KnownSuccess: 'KnownSuccess',
  KnownFail: 'KnownFail',
  KnownSkip: 'KnownSkip',
  KnownTodo: 'KnownTodo',
};

// export type StatusInfo<T> = {[key in TestReconciliationState]: T};
export interface StatusInfo {
  precedence: number;
  desc: string;
}

export const TestResultStatusInfo: { [key in TestReconciliationState]: StatusInfo } = {
  KnownFail: { precedence: 1, desc: 'Failed' },
  Unknown: {
    precedence: 2,
    desc: 'Test has not run yet, due to Jest only running tests related to changes.',
  },
  KnownSkip: { precedence: 3, desc: 'Skipped' },
  KnownSuccess: { precedence: 4, desc: 'Passed' },
  KnownTodo: { precedence: 5, desc: 'Todo' },
};

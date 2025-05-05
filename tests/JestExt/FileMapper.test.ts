jest.unmock('../../src/JestExt/FileMapper');
// jest.unmock('../../src/JestExt/types');

import { FileMapper } from '../../src/JestExt/FileMapper';

// import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

const realPath = jest.requireActual<typeof import('path')>('path');
const realPlatform = process.platform;

const runTestByPlatform = (
  platform: NodeJS.Platform,
  testFunc: (fm: typeof FileMapper, platformPath) => any
) => {
  jest.isolateModules(() => {
    try {
      const platformPath = platform === 'win32' ? realPath.win32 : realPath.posix;
      jest.doMock('path', () => platformPath);

      Object.defineProperty(process, 'platform', { value: platform, configurable: true });

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { FileMapper } = require('../../src/JestExt/FileMapper');

      testFunc(FileMapper, platformPath);
    } finally {
      Object.defineProperty(process, 'platform', { value: realPlatform });
      jest.dontMock('path'); // optional: clean up for next test
    }
  });
};

describe('FileMapper', () => {
  let mockWorkspaceFolder;
  const getWorkspaceFolder = (platform: string): any => {
    return platform === 'win32' ? { uri: { fsPath: 'c:\\workspace' } } : mockWorkspaceFolder;
  };

  beforeEach(() => {
    jest.resetAllMocks();
    jest.restoreAllMocks();
    mockWorkspaceFolder = { uri: { fsPath: '/workspace' } } as vscode.WorkspaceFolder;
  });

  describe('getTestFiles', () => {
    describe('when tests are in different directories', () => {
      const mockConfig = [
        { srcRoot: 'src', testRoot: 'tests', testSuffix: '.test' },
        { srcRoot: 'src', testRoot: 'tests', testSuffix: '.spec' },
      ];
      test.each`
        case  | platform   | srcFile                                          | expectedCandidates
        ${1}  | ${'posix'} | ${'/workspace/src/utils/helper.js'}              | ${['/workspace/tests/utils/helper.test.js', '/workspace/tests/utils/helper.spec.js']}
        ${2}  | ${'win32'} | ${'C:\\workspace\\src\\utils\\helper.js'}        | ${['c:\\workspace\\tests\\utils\\helper.test.js', 'c:\\workspace\\tests\\utils\\helper.spec.js']}
        ${3}  | ${'win32'} | ${'c:\\workspace\\src\\utils\\helper.js'}        | ${['c:\\workspace\\tests\\utils\\helper.test.js', 'c:\\workspace\\tests\\utils\\helper.spec.js']}
        ${4}  | ${'posix'} | ${'/workspace/other/helper.js'}                  | ${undefined}
        ${5}  | ${'win32'} | ${'C:\\workspace\\other\\helper.js'}             | ${undefined}
        ${6}  | ${'posix'} | ${'/workspace/src/utils/helper.test.js'}         | ${undefined}
        ${7}  | ${'win32'} | ${'C:\\workspace\\src\\utils\\helper.test.js'}   | ${undefined}
        ${8}  | ${'posix'} | ${'/workspace/tests/utils/helper.js'}            | ${undefined}
        ${9}  | ${'win32'} | ${'C:\\workspace\\tests\\utils\\helper.js'}      | ${undefined}
        ${10} | ${'posix'} | ${'/workspace/tests/utils/helper.test.js'}       | ${undefined}
        ${11} | ${'win32'} | ${'C:\\workspace\\tests\\utils\\helper.test.js'} | ${undefined}
      `(
        'case $case: should return correct test file candidates on $platform',
        ({ platform, srcFile, expectedCandidates }) => {
          runTestByPlatform(platform, (fmType: typeof FileMapper) => {
            const fm = new fmType(getWorkspaceFolder(platform), mockConfig);
            expect(fm.getTestFiles(srcFile)).toEqual(expectedCandidates);
          });
        }
      );
    });
    describe('when tests are in the same directory as src', () => {
      const mockConfig = [
        {
          srcRoot: 'src',
          testRoot: '__tests__',
          testSuffix: '.spec',
          testRootAtSrc: true,
        },
      ];
      test.each`
        case | platform   | srcFile                                              | expectedCandidates
        ${1} | ${'posix'} | ${'/workspace/src/utils/helper.js'}                  | ${['/workspace/src/utils/__tests__/helper.spec.js']}
        ${2} | ${'win32'} | ${'C:\\workspace\\src\\utils\\helper.js'}            | ${['C:\\workspace\\src\\utils\\__tests__\\helper.spec.js']}
        ${3} | ${'posix'} | ${'/workspace/src/utils/helper.whatever.js'}         | ${['/workspace/src/utils/__tests__/helper.whatever.spec.js']}
        ${4} | ${'win32'} | ${'C:\\workspace\\src\\utils\\helper.whatever.js'}   | ${['C:\\workspace\\src\\utils\\__tests__\\helper.whatever.spec.js']}
        ${5} | ${'posix'} | ${'/workspace/other/helper.js'}                      | ${undefined}
        ${6} | ${'win32'} | ${'C:\\workspace\\other\\helper.js'}                 | ${undefined}
        ${7} | ${'posix'} | ${'/workspace/src/utils/helper.spec.js'}             | ${undefined}
        ${8} | ${'win32'} | ${'C:\\workspace\\src\\utils\\helper.spec.js'}       | ${undefined}
        ${7} | ${'posix'} | ${'/workspace/src/utils/__tests__/helper.js'}        | ${undefined}
        ${8} | ${'win32'} | ${'C:\\workspace\\src\\utils\\__tests__\\helper.js'} | ${undefined}
      `(
        'case $case: should return correct test file candidates on $platform',
        ({ platform, srcFile, expectedCandidates }) => {
          runTestByPlatform(platform, (fmType: typeof FileMapper) => {
            const fm = new fmType(getWorkspaceFolder(platform), mockConfig);
            expect(fm.getTestFiles(srcFile)).toEqual(expectedCandidates);
          });
        }
      );
    });
    describe('when there are multiple src-test mappings', () => {
      const mockConfig = [
        {
          srcRoot: 'src',
          testRoot: '__tests__',
          testSuffix: '.spec',
          testRootAtSrc: true,
        },
        {
          srcRoot: 'integration',
          testRoot: '__tests__',
          testSuffix: '.integ.spec',
          testRootAtSrc: true,
        },
      ];
      test.each`
        case | platform   | srcFile                                         | expectedCandidates
        ${1} | ${'posix'} | ${'/workspace/src/utils/helper.js'}             | ${['/workspace/src/utils/__tests__/helper.spec.js']}
        ${2} | ${'win32'} | ${'C:\\workspace\\src\\utils\\helper.js'}       | ${['C:\\workspace\\src\\utils\\__tests__\\helper.spec.js']}
        ${3} | ${'posix'} | ${'/workspace/integration/requestHelp.js'}      | ${['/workspace/integration/__tests__/requestHelp.integ.spec.js']}
        ${4} | ${'win32'} | ${'C:\\workspace\\integration\\requestHelp.js'} | ${['C:\\workspace\\integration\\__tests__\\requestHelp.integ.spec.js']}
        ${5} | ${'posix'} | ${'/workspace/other/helper.js'}                 | ${undefined}
        ${6} | ${'win32'} | ${'C:\\workspace\\other\\helper.js'}            | ${undefined}
      `(
        'case $case: should return correct test file candidates on $platform',
        ({ platform, srcFile, expectedCandidates }) => {
          runTestByPlatform(platform, (fmType: typeof FileMapper) => {
            const fm = new fmType(getWorkspaceFolder(platform), mockConfig);
            expect(fm.getTestFiles(srcFile)).toEqual(expectedCandidates);
          });
        }
      );
    });
  });

  describe('openTestFileFor', () => {
    describe('with single test file mapping', () => {
      const mockConfig = [
        {
          srcRoot: 'src',
          testRoot: '__tests__',
          testSuffix: '.spec',
          testRootAtSrc: true,
        },
      ];
      it('if no test file matched, show error then return', async () => {
        const platform: any = 'posix';
        const srcFile = '/workspace/not-a-src.js';
        await runTestByPlatform(platform, async (fmType: typeof FileMapper) => {
          vscode.window.showErrorMessage = jest.fn().mockResolvedValue(undefined);
          vscode.window.showTextDocument = jest.fn();

          const fm = new fmType(getWorkspaceFolder(platform), mockConfig);
          await fm.openTestFileFor(srcFile);

          expect(vscode.window.showErrorMessage).toHaveBeenCalled();
          expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
        });
      });

      describe('if only 1 test file matched, should try to open the test file without picker', () => {
        it.each`
          case | platform   | srcFile                                   | testFile                                                  | testFileExists | createTestFile
          ${1} | ${'posix'} | ${'/workspace/src/utils/helper.js'}       | ${'/workspace/src/utils/__tests__/helper.spec.js'}        | ${true}        | ${false}
          ${2} | ${'posix'} | ${'/workspace/src/utils/helper.js'}       | ${'/workspace/src/utils/__tests__/helper.spec.js'}        | ${false}       | ${true}
          ${3} | ${'posix'} | ${'/workspace/src/utils/helper.js'}       | ${'/workspace/src/utils/__tests__/helper.spec.js'}        | ${false}       | ${false}
          ${4} | ${'win32'} | ${'C:\\workspace\\src\\utils\\helper.js'} | ${'C:\\workspace\\src\\utils\\__tests__\\helper.spec.js'} | ${true}        | ${false}
          ${5} | ${'win32'} | ${'C:\\workspace\\src\\utils\\helper.js'} | ${'C:\\workspace\\src\\utils\\__tests__\\helper.spec.js'} | ${false}       | ${true}
          ${6} | ${'win32'} | ${'C:\\workspace\\src\\utils\\helper.js'} | ${'C:\\workspace\\src\\utils\\__tests__\\helper.spec.js'} | ${false}       | ${false}
        `(
          'case $case $platform: testFileExists=$testFileExists,  createTestFile=$createTestFile',
          async ({ platform, srcFile, testFile, testFileExists, createTestFile }) => {
            await runTestByPlatform(platform, async (fmType: typeof FileMapper, platformPath) => {
              // === mock related functions
              jest.spyOn(fs, 'existsSync').mockReturnValue(testFileExists);

              vscode.window.showInformationMessage = jest.fn().mockImplementation(() => {
                return createTestFile ? 'Create and Open' : 'Cancel';
              });
              vscode.window.showErrorMessage = jest.fn().mockResolvedValue(undefined);
              vscode.Uri.file = jest.fn().mockImplementation((file) => {
                const fileUri: any = { fsPath: file };
                fileUri.with = jest.fn().mockImplementation((options) => {
                  return { ...fileUri, ...options };
                });
                return fileUri;
              });
              vscode.workspace.fs.createDirectory = jest.fn();
              vscode.workspace.openTextDocument = jest.fn().mockImplementation((uri) => {
                return Promise.resolve({ uri });
              });
              vscode.window.showTextDocument = jest.fn().mockResolvedValue(undefined);

              // ====

              const fm = new fmType(getWorkspaceFolder(platform), mockConfig);
              await fm.openTestFileFor(srcFile);

              expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
              if (testFileExists) {
                expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
              } else {
                expect(vscode.window.showInformationMessage).toHaveBeenCalled();
              }
              if (createTestFile) {
                expect(vscode.workspace.fs.createDirectory).toHaveBeenCalledWith(
                  expect.objectContaining({ fsPath: platformPath.dirname(testFile) })
                );

                expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(
                  expect.objectContaining({ scheme: 'untitled' })
                );
              } else {
                expect(vscode.workspace.fs.createDirectory).not.toHaveBeenCalled();
              }

              if (testFileExists || createTestFile) {
                const _uri = (vscode.workspace.openTextDocument as jest.Mocked<any>).mock
                  .calls[0][0];
                console.log('uri', _uri);
                expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(
                  expect.objectContaining({ fsPath: testFile })
                );
                expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
                  expect.objectContaining({ uri: expect.objectContaining({ fsPath: testFile }) }),
                  { preview: false }
                );
              } else {
                expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
                expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
              }
            });
          }
        );
      });
    });
    describe('if multiple test files matched, should show picker to select the test file', () => {
      const mockConfig = [
        {
          srcRoot: 'src',
          testRoot: '__tests__',
          testSuffix: '.test',
          testRootAtSrc: true,
        },
        {
          srcRoot: 'src',
          testRoot: '__tests__',
          testSuffix: '.e2e.test',
          testRootAtSrc: true,
        },
      ];
      it.each`
        case | platform   | srcFile                                   | pickFile                                                      | testFileExists | createTestFile
        ${1} | ${'posix'} | ${'/workspace/src/utils/helper.ts'}       | ${undefined}                                                  | ${false}       | ${false}
        ${2} | ${'posix'} | ${'/workspace/src/utils/helper.ts'}       | ${'/workspace/src/utils/__tests__/helper.e2e.test.ts'}        | ${true}        | ${false}
        ${3} | ${'posix'} | ${'/workspace/src/utils/helper.ts'}       | ${'/workspace/src/utils/__tests__/helper.e2e.test.ts'}        | ${false}       | ${true}
        ${4} | ${'posix'} | ${'/workspace/src/utils/helper.ts'}       | ${'/workspace/src/utils/__tests__/helper.e2e.test.ts'}        | ${false}       | ${false}
        ${5} | ${'win32'} | ${'C:\\workspace\\src\\utils\\helper.ts'} | ${undefined}                                                  | ${false}       | ${false}
        ${6} | ${'win32'} | ${'C:\\workspace\\src\\utils\\helper.ts'} | ${'C:\\workspace\\src\\utils\\__tests__\\helper.e2e.test.ts'} | ${true}        | ${false}
        ${7} | ${'win32'} | ${'C:\\workspace\\src\\utils\\helper.ts'} | ${'C:\\workspace\\src\\utils\\__tests__\\helper.test.ts'}     | ${false}       | ${true}
        ${8} | ${'win32'} | ${'C:\\workspace\\src\\utils\\helper.ts'} | ${'C:\\workspace\\src\\utils\\__tests__\\helper.test.ts'}     | ${false}       | ${false}
      `(
        'case $case $platform: testFileExists=$testFileExists,  createTestFile=$createTestFile',
        async ({ platform, srcFile, pickFile, testFileExists, createTestFile }) => {
          await runTestByPlatform(platform, async (fmType: typeof FileMapper, platformPath) => {
            // === mock related functions
            jest.spyOn(fs, 'existsSync').mockReturnValue(testFileExists);

            vscode.window.showInformationMessage = jest.fn().mockImplementation(() => {
              return createTestFile ? 'Create and Open' : 'Cancel';
            });
            vscode.window.showErrorMessage = jest.fn().mockResolvedValue(undefined);
            vscode.Uri.file = jest.fn().mockImplementation((file) => {
              const fileUri: any = { fsPath: file };
              fileUri.with = jest.fn().mockImplementation((options) => {
                return { ...fileUri, ...options };
              });
              return fileUri;
            });

            vscode.workspace.fs.createDirectory = jest.fn();
            vscode.workspace.openTextDocument = jest.fn().mockImplementation((uri) => {
              return Promise.resolve({ uri });
            });
            vscode.window.showTextDocument = jest.fn().mockResolvedValue(undefined);
            vscode.window.showQuickPick = jest.fn().mockResolvedValueOnce(pickFile);
            // ====

            const fm = new fmType(getWorkspaceFolder(platform), mockConfig);
            await fm.openTestFileFor(srcFile);

            expect(vscode.window.showQuickPick).toHaveBeenCalledTimes(1);
            const showQuickPickCandidates = (vscode.window.showQuickPick as jest.Mock).mock
              .calls[0][0];
            expect(showQuickPickCandidates).toHaveLength(2);
            if (pickFile) {
              expect(showQuickPickCandidates).toEqual(expect.arrayContaining([pickFile]));
            } else {
              return;
            }

            if (testFileExists) {
              expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
            } else {
              expect(vscode.window.showInformationMessage).toHaveBeenCalled();
            }
            if (createTestFile) {
              expect(vscode.workspace.fs.createDirectory).toHaveBeenCalledWith(
                expect.objectContaining({ fsPath: platformPath.dirname(pickFile) })
              );

              expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(
                expect.objectContaining({ scheme: 'untitled' })
              );
            } else {
              expect(vscode.workspace.fs.createDirectory).not.toHaveBeenCalled();
            }

            if (testFileExists || createTestFile) {
              expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(
                expect.objectContaining({ fsPath: pickFile })
              );
              expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
                expect.objectContaining({ uri: expect.objectContaining({ fsPath: pickFile }) }),
                { preview: false }
              );
            } else {
              expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
              expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
            }
          });
        }
      );
    });
  });
  describe('has a cache for test file candidates', () => {
    it('should cache the test file candidates', () => {
      const mockConfig = [{ srcRoot: 'src', testRoot: 'tests', testSuffix: '.test' }];
      runTestByPlatform('posix' as any, (fmType: typeof FileMapper, platformPath) => {
        const pathJoinSpy = jest.spyOn(platformPath, 'join');

        const fm = new fmType(getWorkspaceFolder('posix'), mockConfig);
        const srcFile = '/workspace/src/utils/helper.js';
        const expectedCandidates = ['/workspace/tests/utils/helper.test.js'];

        expect(fm.getTestFiles(srcFile)).toEqual(expectedCandidates);
        const count = pathJoinSpy.mock.calls.length;
        expect(count).toBeGreaterThan(0);

        expect(fm.getTestFiles(srcFile)).toEqual(expectedCandidates);
        expect(pathJoinSpy.mock.calls.length).toEqual(count); // No new calls to path.join
      });
    });
  });
  describe('getSourceFile', () => {
    describe('centralized tests directory', () => {
      const mockConfig = [{ srcRoot: 'src', testRoot: 'tests', testSuffix: '.test' }];

      test.each`
        case | platform   | testFile                                            | expectedSrc
        ${1} | ${'posix'} | ${'/workspace/tests/utils/helper.test.js'}          | ${'/workspace/src/utils/helper.js'}
        ${2} | ${'win32'} | ${'C:\\workspace\\tests\\utils\\helper.test.js'}    | ${'c:\\workspace\\src\\utils\\helper.js'}
        ${3} | ${'win32'} | ${'c:\\workspace\\tests\\utils\\helper.test.js'}    | ${'c:\\workspace\\src\\utils\\helper.js'}
        ${4} | ${'posix'} | ${'/workspace/tests/utils/helper.whatever.test.ts'} | ${'/workspace/src/utils/helper.whatever.ts'}
      `(
        'case $case – returns correct source file on $platform platform',
        ({ platform, testFile, expectedSrc }) => {
          runTestByPlatform(platform as any, (FM, _path) => {
            const fm = new FM(getWorkspaceFolder(platform as any), mockConfig);
            expect(fm.getSourceFile(testFile)).toEqual(expectedSrc);
          });
        }
      );
    });

    describe('tests collocated in __tests__ folder next to src', () => {
      const mockConfig = [
        { srcRoot: 'src', testRoot: '__tests__', testSuffix: '.spec', testRootAtSrc: true },
      ];

      test.each`
        case | platform   | testFile                                                  | expectedSrc
        ${1} | ${'posix'} | ${'/workspace/src/utils/__tests__/helper.spec.ts'}        | ${'/workspace/src/utils/helper.ts'}
        ${2} | ${'win32'} | ${'C:\\workspace\\src\\utils\\__tests__\\helper.spec.ts'} | ${'C:\\workspace\\src\\utils\\helper.ts'}
        ${3} | ${'win32'} | ${'c:\\workspace\\src\\utils\\__tests__\\helper.spec.ts'} | ${'c:\\workspace\\src\\utils\\helper.ts'}
      `(
        'case $case – returns correct source file on $platform platform',
        ({ platform, testFile, expectedSrc }) => {
          runTestByPlatform(platform as any, (FM) => {
            const fm = new FM(getWorkspaceFolder(platform as any), mockConfig);
            expect(fm.getSourceFile(testFile)).toEqual(expectedSrc);
          });
        }
      );
    });

    describe('caches look‑ups', () => {
      const mockConfig = [{ srcRoot: 'src', testRoot: 'tests', testSuffix: '.test' }];

      it('should memoise getSourceFile results', () => {
        runTestByPlatform('posix' as any, (FM, platformPath) => {
          const pathJoinSpy = jest.spyOn(platformPath, 'join');
          const fm = new FM(getWorkspaceFolder('posix' as any), mockConfig);
          const testFile = '/workspace/tests/utils/helper.test.js';

          const expectedSrc = '/workspace/src/utils/helper.js';
          expect(fm.getSourceFile(testFile)).toEqual(expectedSrc);
          const callCount = pathJoinSpy.mock.calls.length;
          expect(callCount).toBeGreaterThan(0);

          // second call should hit cache – no extra join invocations
          expect(fm.getSourceFile(testFile)).toEqual(expectedSrc);
          expect(pathJoinSpy.mock.calls.length).toEqual(callCount);
        });
      });
    });
  });

  describe('openSourceFileFor', () => {
    const mockConfig = [{ srcRoot: 'src', testRoot: 'tests', testSuffix: '.test' }];

    beforeEach(() => {
      jest.resetAllMocks();
      // minimal fs + vscode mocks
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      (vscode.workspace.fs as any) = {
        createDirectory: jest.fn().mockResolvedValue(undefined),
      };
      vscode.window.showErrorMessage = jest.fn().mockResolvedValue(undefined);
      vscode.window.showTextDocument = jest.fn().mockResolvedValue(undefined as any);
      vscode.workspace.openTextDocument = jest.fn().mockResolvedValue({} as any);
    });

    it('shows error when no source file matched', async () => {
      await runTestByPlatform('posix' as any, async (FM) => {
        const fm = new FM(getWorkspaceFolder('posix' as any), mockConfig);
        const bogusTestFile = '/workspace/tests/not-exist.test.js';

        // Force match failure
        jest.spyOn(fm, 'getSourceFile').mockReturnValue(undefined);

        await fm.openSourceFileFor(bogusTestFile);
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
          expect.stringContaining('No source file matched')
        );
        expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
      });
    });

    it('opens editor when a source file is found', async () => {
      await runTestByPlatform('posix' as any, async (FM) => {
        const fm = new FM(getWorkspaceFolder('posix' as any), mockConfig);
        const testFile = '/workspace/tests/utils/helper.test.js';
        const srcFile = '/workspace/src/utils/helper.js';

        // Ensure mapping exists and fs says it exists
        jest.spyOn(fm, 'getSourceFile').mockReturnValue(srcFile);
        jest.spyOn(fs, 'existsSync').mockReturnValue(true);

        await fm.openSourceFileFor(testFile);

        expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(vscode.Uri.file(srcFile));
        expect(vscode.window.showTextDocument).toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      });
    });
  });
  describe('testing with SrcTestFileMapping settings', () => {
    it.each`
      case  | platform   | srcRoot           | testRoot                  | testRootAtSrc | srcFile                                              | testFile
      ${1}  | ${'posix'} | ${'src'}          | ${'__tests__'}            | ${true}       | ${'/workspace/src/utils/helper.mjs'}                 | ${'/workspace/src/utils/__tests__/helper.test.mjs'}
      ${2}  | ${'win32'} | ${'src'}          | ${'__tests__'}            | ${true}       | ${'c:\\workspace\\src\\utils\\helper.mjs'}           | ${'c:\\workspace\\src\\utils\\__tests__\\helper.test.mjs'}
      ${3}  | ${'win32'} | ${'src'}          | ${'__tests__'}            | ${true}       | ${'C:\\workspace\\src\\utils\\helper.mjs'}           | ${'C:\\workspace\\src\\utils\\__tests__\\helper.test.mjs'}
      ${4}  | ${'posix'} | ${'src'}          | ${'something/__tests__'}  | ${true}       | ${'/workspace/src/utils/helper.mjs'}                 | ${'/workspace/src/utils/something/__tests__/helper.test.mjs'}
      ${5}  | ${'posix'} | ${'src'}          | ${'/something/__tests__'} | ${true}       | ${'/workspace/src/utils/helper.mjs'}                 | ${'/workspace/src/utils/something/__tests__/helper.test.mjs'}
      ${6}  | ${'win32'} | ${'src'}          | ${'something/__tests__'}  | ${true}       | ${'c:\\workspace\\src\\utils\\helper.mjs'}           | ${'c:\\workspace\\src\\utils\\something\\__tests__\\helper.test.mjs'}
      ${7}  | ${'posix'} | ${'whatever/src'} | ${'__tests__'}            | ${true}       | ${'/workspace/whatever/src/utils/helper.mjs'}        | ${'/workspace/whatever/src/utils/__tests__/helper.test.mjs'}
      ${8}  | ${'posix'} | ${'whatever/src'} | ${'something/__tests__'}  | ${true}       | ${'/workspace/whatever/src/utils/helper.mjs'}        | ${'/workspace/whatever/src/utils/something/__tests__/helper.test.mjs'}
      ${9}  | ${'posix'} | ${'whatever/src'} | ${'something/__tests__'}  | ${false}      | ${'/workspace/whatever/src/utils/helper.cjs'}        | ${'/workspace/something/__tests__/utils/helper.test.cjs'}
      ${10} | ${'win32'} | ${'whatever/src'} | ${'something/__tests__'}  | ${true}       | ${'c:\\workspace\\whatever\\src\\utils\\helper.mjs'} | ${'c:\\workspace\\whatever\\src\\utils\\something\\__tests__\\helper.test.mjs'}
      ${11} | ${'win32'} | ${'whatever/src'} | ${'something/__tests__'}  | ${false}      | ${'c:\\workspace\\whatever\\src\\utils\\helper.cjs'} | ${'c:\\workspace\\something\\__tests__\\utils\\helper.test.cjs'}
    `(
      'case $case: $platform',
      ({ platform, srcRoot, testRoot, testRootAtSrc, srcFile, testFile }) => {
        runTestByPlatform(platform as any, (FM) => {
          const settings: any = [{ srcRoot, testRoot, testRootAtSrc, testSuffix: '.test' }];
          const fm = new FM(getWorkspaceFolder(platform as any), settings);
          const testFiles = fm.getTestFiles(srcFile);
          expect(testFiles).toEqual([testFile]);
          const srcFiles = fm.getSourceFile(testFile);
          expect(srcFiles).toEqual(srcFile);
        });
      }
    );
  });
});

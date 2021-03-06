jest.unmock('../../../src/setup-wizard/tasks/setup-jest-cmdline');
jest.unmock('../test-helper');
jest.unmock('./task-test-helper');

import * as vscode from 'vscode';

import * as helper from '../../../src/setup-wizard/wizard-helper';
import {
  setupJestCmdLine,
  CLSetupActionId,
} from '../../../src/setup-wizard/tasks/setup-jest-cmdline';

import { mockWizardHelper } from '../test-helper';
import { validateTaskConfigUpdate, createWizardContext } from './task-test-helper';
import * as path from 'path';

const mockHelper = helper as jest.Mocked<any>;
const { mockShowActionMenu, mockShowActionMessage, mockHelperSetup } = mockWizardHelper(mockHelper);

describe('wizard-tasks', () => {
  const mockSaveConfig = jest.fn();
  const debugConfigProvider = {};
  let wizardSettings: { [key: string]: any };

  beforeEach(() => {
    jest.resetAllMocks();

    vscode.workspace.getConfiguration = jest.fn().mockReturnValue({
      // get: mockConfigGet,
      update: mockSaveConfig,
    });

    wizardSettings = {};
    mockHelperSetup();

    // default helper function
    mockHelper.showActionMenu.mockReturnValue('success');
    mockHelper.showActionInputBox.mockImplementation(({ value }) => value);
    mockSaveConfig.mockImplementation(() => Promise.resolve());

    mockHelper.showActionMessage.mockImplementation((_, options) => {
      return options?.action?.();
    });
    mockHelper.getWizardSettings.mockImplementation(() => wizardSettings);
    mockHelper.createSaveConfig.mockReturnValue(mockSaveConfig);
  });

  describe('setupJestCmdLine', () => {
    const validateConfigUpdate = (callBack?: (value?: string) => void) =>
      validateTaskConfigUpdate(mockSaveConfig, 'jest.jestCommandLine', callBack);

    let context;
    beforeEach(() => {
      context = createWizardContext('single-root', debugConfigProvider);
    });
    describe('wthout existing command settings should ask user to input it', () => {
      it.each`
        desc                 | settings
        ${'no setting'}      | ${{}}
        ${'only jestConfig'} | ${{ pathToConfig: 'jest-config.js' }}
      `('$desc is considered "no existing settings"', async () => {
        expect.hasAssertions();

        mockHelper.getConfirmation = jest.fn().mockReturnValue(Promise.resolve(true));

        await setupJestCmdLine(context);

        expect(mockHelper.getConfirmation).toHaveBeenCalled();
        expect(mockHelper.showActionInputBox).toHaveBeenCalled();
      });
      it('abort wizard if user can not run jest tests in terminal yet', async () => {
        expect.hasAssertions();

        mockHelper.getConfirmation = jest.fn().mockReturnValue(Promise.resolve(false));
        // mock the info message
        mockShowActionMessage('warning', CLSetupActionId.info);

        await expect(setupJestCmdLine(context)).resolves.toEqual('error');
        expect(mockHelper.getConfirmation).toHaveBeenCalled();
        expect(mockHelper.showActionMessage).toHaveBeenCalled();
        expect(mockHelper.showActionInputBox).not.toHaveBeenCalled();
      });
      describe('when use can run jest in terminal', () => {
        beforeEach(() => {
          mockHelper.getConfirmation = jest.fn().mockReturnValue(Promise.resolve(true));
        });

        it.each`
          input                 | jestCmdLine          | result
          ${''}                 | ${''}                | ${'abort'}
          ${'abc'}              | ${'abc'}             | ${'success'}
          ${'jest --coverage '} | ${'jest --coverage'} | ${'success'}
          ${'  \t '}            | ${''}                | ${'abort'}
          ${undefined}          | ${undefined}         | ${'abort'}
        `('with "$input" => $result', async ({ input, jestCmdLine, result }) => {
          expect.hasAssertions();

          mockHelper.showActionInputBox = jest.fn().mockReturnValue(Promise.resolve(input));
          await expect(setupJestCmdLine(context)).resolves.toEqual(result);

          // prompt user input for commandLine
          expect(mockHelper.getConfirmation).toHaveBeenCalled();
          expect(mockHelper.showActionInputBox).toHaveBeenCalled();

          if (result === 'success') {
            validateConfigUpdate((cmdLine) => expect(cmdLine).toEqual(jestCmdLine));
          } else {
            // jestCommandLine will not be changed nor saved
            validateConfigUpdate();
          }
        });
        it('will abort task if input is abort (returns undefined)', async () => {
          expect.hasAssertions();

          mockHelper.getConfirmation = jest.fn().mockReturnValue(Promise.resolve(true));
          // user click ok in the info panel
          mockShowActionMessage('info', CLSetupActionId.info);

          await expect(setupJestCmdLine(context)).resolves.toEqual('abort');
          expect(mockHelper.showActionInputBox).toHaveBeenCalled();
        });
      });
    });
    describe.each`
      desc                             | settings                                                                                          | expectedCmdLine
      ${'pathToJest'}                  | ${{ pathToJest: 'abc -x' }}                                                                       | ${'abc -x'}
      ${'pathToJest and pathToConfig'} | ${{ pathToJest: 'abc -x', pathToConfig: `"${path.join('dir with space', 'shared-jest.json')}"` }} | ${`abc -x --config "${path.join('dir with space', 'shared-jest.json')}"`}
    `('with legacy command settings: $desc', ({ settings, expectedCmdLine }) => {
      it.each`
        menuId                     | result
        ${CLSetupActionId.upgrade} | ${'success'}
        ${undefined}               | ${undefined}
      `('menu $menuId returns $result', async ({ menuId, result }) => {
        expect.hasAssertions();
        wizardSettings = settings;

        // user click on menu
        mockShowActionMenu(menuId);

        await expect(setupJestCmdLine(context)).resolves.toEqual(result);

        // user will be able to editing it before update
        if (menuId != null) {
          expect(mockHelper.showActionInputBox).toBeCalled();

          // both jestCommandLine and debug config should be updated
          validateConfigUpdate((cmdLine) => expect(cmdLine).toEqual(expectedCmdLine));
        } else {
          // user abort the menu
          expect(mockHelper.showActionInputBox).not.toBeCalled();
          validateConfigUpdate();
        }
      });
    });
    describe.each`
      desc                                              | settings                                                                                  | expectedCmdLine
      ${'jestCommandLine'}                              | ${{ jestCommandLine: 'abc -x' }}                                                          | ${'abc -x'}
      ${'jestCommandLine, pathToJest and pathToConfig'} | ${{ jestCommandLine: 'abc -y ', pathToJest: 'abc', pathToConfig: '../shared-jest.json' }} | ${'abc -y'}
    `('with jestCommandLine settings: $desc', ({ settings, expectedCmdLine }) => {
      it.each`
        menuId                            | result       | updatedCmdLine
        ${CLSetupActionId.acceptExisting} | ${'success'} | ${false}
        ${CLSetupActionId.edit}           | ${'success'} | ${true}
        ${undefined}                      | ${undefined} | ${false}
      `('menu $menuId returns $result', async ({ menuId, result, updatedCmdLine }) => {
        expect.hasAssertions();
        wizardSettings = settings;

        // user click on menu
        mockShowActionMenu(menuId);

        await expect(setupJestCmdLine(context)).resolves.toEqual(result);

        // user will be able to editing it before update
        if (updatedCmdLine) {
          expect(mockHelper.showActionInputBox).toBeCalled();

          // both jestCommandLine and debug config should be updated
          validateConfigUpdate((cmdLine) => expect(cmdLine).toEqual(expectedCmdLine));
        } else {
          // user abort the menu
          expect(mockHelper.showActionInputBox).not.toBeCalled();
          validateConfigUpdate();
        }
      });
    });
    describe('when user enter an invalid commandLine, a warning message will be shown for correction', () => {
      beforeEach(() => {
        mockHelper.getConfirmation = jest.fn().mockReturnValue(Promise.resolve(true));
        mockHelper.showActionInputBox = jest.fn().mockReturnValue('an invalid command line');
        mockHelper.validateCommandLine = jest.fn().mockReturnValueOnce('invalid command');
      });
      describe('when no existing settings', () => {
        it('user can choose to re-edit the command', async () => {
          expect.hasAssertions();
          mockShowActionMessage('warning', CLSetupActionId.editInvalidCmdLine);
          await expect(setupJestCmdLine(context)).resolves.toEqual('success');
          // showing warniing
          expect(mockHelper.showActionMessage).toBeCalledTimes(1);
          // show input box for editing and reediting
          expect(mockHelper.showActionInputBox).toBeCalledTimes(2);
        });
        it('user can still choose to accept the command as it is', async () => {
          expect.hasAssertions();
          mockShowActionMessage('warning', CLSetupActionId.acceptInvalidCmdLine);
          await expect(setupJestCmdLine(context)).resolves.toEqual('success');
          // showing warniing
          expect(mockHelper.showActionMessage).toBeCalledTimes(1);
          // show input box for editing
          expect(mockHelper.showActionInputBox).toBeCalledTimes(1);
        });
      });
      describe('when existing jestCommandLine is invalid: shows a warning panel', () => {
        beforeEach(() => {
          wizardSettings = { jestCommandLine: 'npm test' };
        });
        it('use can still choose to accept the command line', async () => {
          expect.hasAssertions();

          mockShowActionMessage('warning', CLSetupActionId.acceptInvalidCmdLine);
          await expect(setupJestCmdLine(context)).resolves.toEqual('success');

          // showing warniing
          expect(mockHelper.showActionMessage).toBeCalledTimes(1);

          // no input box
          expect(mockHelper.showActionInputBox).not.toBeCalled();

          // no menu will be shown
          expect(mockHelper.showActionMenu).not.toHaveBeenCalled();
        });
        describe('use can choose to edit the command line', () => {
          beforeEach(() => {
            mockShowActionMessage('warning', CLSetupActionId.editInvalidCmdLine);
          });
          it('an input box will be prompt', async () => {
            expect.hasAssertions();

            await expect(setupJestCmdLine(context)).resolves.toEqual('success');
            // showing warniing
            expect(mockHelper.showActionMessage).toBeCalledTimes(1);
            // show input box for editing
            expect(mockHelper.showActionInputBox).toBeCalledTimes(1);

            // no menu will be shown
            expect(mockHelper.showActionMenu).not.toHaveBeenCalled();
          });
          it('if user still input an invalid cmdLine, the warning panel will be shown again', async () => {
            expect.hasAssertions();
            mockHelper.validateCommandLine.mockReturnValueOnce('invalid command still');
            await expect(setupJestCmdLine(context)).resolves.toEqual('success');
            // showing warniing twice
            expect(mockHelper.showActionMessage).toBeCalledTimes(2);
            // show input box for editing twice
            expect(mockHelper.showActionInputBox).toBeCalledTimes(2);

            // no menu will be shown
            expect(mockHelper.showActionMenu).not.toHaveBeenCalled();
          });
        });
      });
    });
  });
});

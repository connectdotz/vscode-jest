import * as vscode from 'vscode';
import { JestExt } from '../JestExt';
import { TestItemDataType, WorkspaceRoot, DocumentRoot } from './test-item-dats';

export class JestTestController implements vscode.TestController<TestItemDataType> {
  constructor(private readonly getExt: (name: string) => JestExt) {}

  /**
   * @inheritdoc
   */
  public createWorkspaceTestRoot(workspaceFolder: vscode.WorkspaceFolder): WorkspaceRoot['item'] {
    const jestExt = this.getExt(workspaceFolder.name);
    return jestExt?.workspaceItemRoot.item;
  }

  /**
   * @inheritdoc
   */
  public createDocumentTestRoot(document: vscode.TextDocument): DocumentRoot['item'] {
    const wsName = vscode.workspace.getWorkspaceFolder(document.uri)?.name;
    if (!wsName) {
      throw new Error(`invalid document, failed to obtain workspaceFolder info: ${document.uri}`);
    }
    const wsRoot = this.getExt(wsName)?.workspaceItemRoot;
    if (!wsRoot) {
      throw new Error(`no WorkspaceRoot has been created for document ${document.uri}`);
    }
    return wsRoot.addTestFile(document.fileName).item;
  }

  /**
   * @inheritdoc
   */
  public async runTests(
    request: vscode.TestRunRequest<TestItemDataType>,
    cancellation: vscode.CancellationToken
  ): Promise<void> {
    const run = vscode.test.createTestRun(request);
    const tests = request.tests.filter((t) => !request.exclude?.includes(t));
    for (const test of tests) {
      run.appendOutput(`Running ${test.id}\r\n`);
      let success = false;
      if (cancellation.isCancellationRequested) {
        run.setState(test, vscode.TestResultState.Skipped);
      } else {
        run.setState(test, vscode.TestResultState.Running);
        success = await test.data.runTest(run);
      }
      run.appendOutput(`Completed ${test.id}, success=${success}\r\n`);
    }
  }
}

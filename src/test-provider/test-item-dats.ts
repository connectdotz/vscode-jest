import * as vscode from 'vscode';
import { TestResult } from '../TestResults/TestResult';
import { extensionId } from '../appGlobals';
import { JestExtContext } from '../JestExt';
import { TestReconciliationStateType, TestResultProvider } from '../TestResults';
import * as path from 'path';
import { JestExtRequestType, ProcessSession } from '../JestExt/process-session';
import { TestAssertionStatus } from '../../../jest-editor-support';
import { DataNode, NodeType, ROOT_NODE_NAME } from '../TestResults/match-node';
import { Logging } from '../logging';
import { TestSuitChangeEvent } from '../TestResults/TestResultEvent';

export type TestItemDataType = WorkspaceRoot | DocumentRoot | FolderData | TestBlock;

export interface TestItemDataContext extends JestExtContext {
  session: ProcessSession;
  testResolveProvider: TestResultProvider;
}
type DocumentRootItem = DocumentRoot['item'];

export interface TestItemData<T, TChild> {
  readonly item: vscode.TestItem<T, TChild>;
  readonly context: TestItemDataContext;
  runTest: (run: vscode.TestRun<T>) => Promise<boolean>;
}
class TestItemDataBase<T, TChild> implements TestItemData<T, TChild> {
  item!: vscode.TestItem<T, TChild>;
  log: Logging;

  constructor(readonly context: TestItemDataContext, name: string) {
    this.log = context.loggingFactory.create(name);
  }
  runTest(_run: vscode.TestRun<T>): Promise<boolean> {
    return Promise.reject('derived class should implement');
  }
  runTestWithRequest(run: vscode.TestRun<T>, request: JestExtRequestType): Promise<boolean> {
    // run test that match the filePath
    const scheduled = this.context.session.scheduleProcess(request);
    if (scheduled) {
      run.setState(this.item, vscode.TestResultState.Queued);
    } else {
      run.setState(this.item, vscode.TestResultState.Errored);
      run.appendMessage(
        this.item,
        new vscode.TestMessage(`failed to schedule "${request.type}" run`)
      );
    }
    return Promise.resolve(scheduled);
  }
}

/**
 * Goal of this class is to manage the TestItem hierarchy reflects DocumentRoot path. It is responsible
 * to create DocumentRoot for each test file by listening to the TestResultEvents.
 */
export class WorkspaceRoot extends TestItemDataBase<WorkspaceRoot, FolderData | DocumentRoot> {
  private DocumentRoots: Map<string, DocumentRoot>;

  constructor(
    readonly context: TestItemDataContext,
    private readonly workspaceFolder: vscode.WorkspaceFolder
  ) {
    super(context, 'WorkspaceRoot');
    this.DocumentRoots = new Map();
    this.item = this.createTestItem(workspaceFolder);
  }
  private createTestItem(workspaceFolder: vscode.WorkspaceFolder) {
    const item = vscode.test.createTestItem<WorkspaceRoot, FolderData | DocumentRoot>(
      {
        id: `${extensionId}:${workspaceFolder.name}`,
        label: `Jest Tests: ${workspaceFolder.name}`,
        uri: workspaceFolder.uri,
      },
      this
    );

    item.status = vscode.TestItemStatus.Pending;
    item.resolveHandler = (token): void => {
      const listeners = this.registerEvents();
      const testList = this.context.testResolveProvider.getTestList();
      this.onTestListUpdated(testList);
      token.onCancellationRequested(() => {
        item.status = vscode.TestItemStatus.Pending;
        listeners.forEach((l) => l.dispose());
      });
    };

    item.runnable = !this.context.autoRun.isWatch;
    item.debuggable = false;

    return item;
  }

  runTest(run: vscode.TestRun<WorkspaceRoot>): Promise<boolean> {
    // run test for the whole workspace
    return this.runTestWithRequest(run, { type: 'all-tests' });
  }

  // test result event handling
  registerEvents = (): vscode.Disposable[] => {
    const events = this.context.testResolveProvider.events;
    const listeners: vscode.Disposable[] = [
      events.testListUpdated.event(this.onTestListUpdated),
      events.testSuiteChanged.event(this.onTestSuiteChanged),
    ];
    return listeners;
  };
  addFolder = (parent: FolderData | undefined, folderName: string): FolderData => {
    const p = parent ?? this;
    const existing = p.item.children.get(folderName) as FolderData['item'];
    if (existing) {
      return existing.data;
    }
    const parts = parent ? [...parent.pathParts, folderName] : [folderName];
    const folder = new FolderData(this.context, parts);
    p.item.addChild(folder.item);

    return folder;
  };
  addPath = (absoluteFileName: string): FolderData | undefined => {
    const relativePath = path.relative(this.workspaceFolder.uri.fsPath, absoluteFileName);
    const folders = relativePath.split(path.sep).slice(0, -1);

    return folders.reduce(this.addFolder, undefined);
  };
  addTestFile = (absoluteFileName: string): DocumentRoot | undefined => {
    if (this.context.testResolveProvider.isTestFile(absoluteFileName) !== 'yes') {
      return;
    }
    const docRoot = this.DocumentRoots.get(absoluteFileName);
    if (docRoot) {
      return docRoot;
    }
    const parent = this.addPath(absoluteFileName) ?? this;
    let documentRootItem = parent.item.children.get(absoluteFileName) as DocumentRootItem;
    if (!documentRootItem) {
      documentRootItem = new DocumentRoot(
        this.context,
        vscode.Uri.file(absoluteFileName),
        vscode.TestItemStatus.Pending
      ).item;

      parent.item.addChild(documentRootItem);
      this.DocumentRoots.set(absoluteFileName, documentRootItem.data);
    }

    return documentRootItem.data;
  };
  onTestListUpdated = (absoluteFileNames: string[] | undefined): void => {
    if (!absoluteFileNames || absoluteFileNames.length <= 0) {
      // error or no test file...  do nothing
      this.log('debug', 'onTestListUpdated received 0 test file list');
      return;
    }
    absoluteFileNames.forEach((f) => this.addTestFile(f));
    this.item.status = vscode.TestItemStatus.Resolved;
  };
  onTestSuiteChanged = (event: TestSuitChangeEvent): void => {
    event.files.forEach((f) => this.addTestFile(f));
    this.item.status = vscode.TestItemStatus.Resolved;
  };
}

class FolderData extends TestItemDataBase<FolderData, FolderData | DocumentRoot> {
  // item: vscode.TestItem<FolderData, FolderData | DocumentRoot>;
  constructor(readonly context: TestItemDataContext, readonly pathParts: string[]) {
    super(context, 'FolderData');
    this.item = this.createTestItem(pathParts[pathParts.length - 1]);
  }
  private createTestItem(name: string) {
    const item = vscode.test.createTestItem<FolderData, FolderData | DocumentRoot>(
      { id: name, label: name },
      this
    );

    item.runnable = !this.context.autoRun.isWatch;
    item.debuggable = false;

    item.status = vscode.TestItemStatus.Resolved;
    return item;
  }
  runTest(run: vscode.TestRun<FolderData>): Promise<boolean> {
    // run test that match the filePath
    return this.runTestWithRequest(run, {
      type: 'by-file-pattern',
      testFileNamePattern: this.pathParts.join(path.sep),
    });
  }
}

interface DocumentRootTestRunOption {
  name?: string;
  includeTestNodes?: boolean;
}
type DocumentRootDataType = DocumentRoot | TestBlock;
interface DocumentRootRunReturn {
  request: vscode.TestRunRequest<DocumentRootDataType>;
  run: vscode.TestRun<DocumentRootDataType>;
}

export class DocumentRoot extends TestItemDataBase<DocumentRoot, TestBlock> {
  private testMap: Map<string, TestBlock[]>;
  private resultState: vscode.TestResultState;

  constructor(
    readonly context: TestItemDataContext,
    uri: vscode.Uri,
    itemStatus: vscode.TestItemStatus
  ) {
    super(context, 'DocumentRoot');
    this.item = this.createTestItem(uri, itemStatus);
    this.resultState = vscode.TestResultState.Unset;
    this.testMap = new Map();
  }

  private createTestItem(uri: vscode.Uri, itemStatus: vscode.TestItemStatus) {
    const item = vscode.test.createTestItem<DocumentRoot, TestBlock>(
      { id: uri.fsPath, label: path.basename(uri.fsPath), uri },
      this
    );

    item.runnable = !this.context.autoRun.isWatch;
    item.debuggable = true;
    item.status = itemStatus;
    item.resolveHandler = (token) => {
      const listeners = this.registerEvents();
      this.discoverTests();
      this.updateTestStates();

      token.onCancellationRequested(() => {
        item.status = vscode.TestItemStatus.Pending;
        listeners.forEach((l) => l.dispose());
      });
    };
    return item;
  }
  runTest(run: vscode.TestRun<this>): Promise<boolean> {
    // run test for the given file
    return this.runTestWithRequest(run, {
      type: 'by-file',
      testFileName: this.item.id,
    });
  }

  registerEvents = (): vscode.Disposable[] => {
    const events = this.context.testResolveProvider.events;
    return [events.testSuiteChanged.event(this.onTestSuiteChanged)];
  };

  getAllChildren = (
    item: vscode.TestItem<DocumentRootDataType, TestBlock>
  ): vscode.TestItem<DocumentRootDataType, TestBlock>[] => {
    let children = [item];
    for (const child of item.children.values()) {
      children = children.concat(this.getAllChildren(child));
    }
    return children;
  };
  createRun = (option?: DocumentRootTestRunOption): DocumentRootRunReturn => {
    const tests = option?.includeTestNodes ? this.getAllChildren(this.item) : [this.item];
    const request: vscode.TestRunRequest<DocumentRootDataType> = { tests, debug: false };
    return { request, run: vscode.test.createTestRun(request, option?.name) };
  };
  onDiscoveryCompleted = (): void => {
    this.item.status = vscode.TestItemStatus.Resolved;
  };
  onTestSuiteChanged = (event: TestSuitChangeEvent): void => {
    if (!event.files.find((f) => f === this.item.id)) {
      return;
    }

    switch (event.reason) {
      case 'assertions-updated':
        this.discoverTests();
        this.updateTestStates();
        break;
      case 'result-matched':
        this.updateSourceInfo();
    }
  };
  discoverTests = (): void => {
    const suite = this.context.testResolveProvider.getTestSuiteResult(this.item.id);
    if (!suite) {
      return;
    }

    this.item.children.forEach((item) => item.dispose());
    this.testMap.clear();

    this.resultState = TestResultStateMap.get(suite.status) ?? vscode.TestResultState.Unset;
    if (!suite.assertionContainer) {
      return this.onDiscoveryCompleted();
    }

    this.addNode(this, suite.assertionContainer);
    if (suite.results) {
      this.updateSourceInfo(suite.results);
    }
    return this.onDiscoveryCompleted();
  };

  updateTestStates = (): void => {
    const { request, run } = this.createRun({
      name: `onTestAssertionUpdated: ${this.item.id}`,
      includeTestNodes: true,
    });
    run.appendOutput(`updating test status for ${request.tests.length} items\r\n`);
    request.tests.forEach((item) => item.data.setResultState(run));
    run.appendOutput('test status all updated\r\n');
    run.end();
  };

  updateSourceInfo = (results?: TestResult[]): void => {
    const _results =
      results ?? this.context.testResolveProvider.getTestSuiteResult(this.item.id)?.results;
    if (!_results) {
      return;
    }
    // update each testBlock from matched result
    _results.forEach((r) => {
      const testBlocks = this.testMap.get(this.makeTestId(r.name));
      if (!testBlocks) {
        return;
      }
      testBlocks.forEach((t) => t.updateWithMatchResult(r));
    });
  };

  setResultState = (run: vscode.TestRun<DocumentRootDataType>): void => {
    run.setState(this.item, this.resultState);
    run.appendOutput(`updateState: "${this.item.label}": ${this.resultState}\r\n`);
  };

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  makeTestId = (testFullName: string): string => TestBlock.makeId(this.item.uri!, testFullName);
  addTestBlock = (testId: string, data: TestBlock): void => {
    const list = this.testMap.get(testId) ?? [];
    list.push(data);
    this.testMap.set(testId, list);
  };

  addNode = (parentNode: TestBlock | this, node: NodeType<TestAssertionStatus>): void => {
    let parent = parentNode;
    if (node.name !== ROOT_NODE_NAME) {
      const testId = this.makeTestId(node.fullName);
      let child = parent.item.children.get(testId)?.data as TestBlock;
      if (!child) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        child = new TestBlock(this.context, this.item.uri!, node);
        this.addTestBlock(testId, child);
        parent.item.addChild(child.item);
      }
      parent = child;
    }
    if (!isDataNode(node)) {
      const nodes = [...node.childContainers, ...node.childData];
      nodes.forEach((n) => this.addNode(parent, n));
    }
    const group = node.getAll().slice(1);
    group.forEach((m) => this.addNode(parentNode, m));
  };
}

const TestResultStateMap: Map<TestReconciliationStateType, vscode.TestResultState> = new Map([
  ['Unknown', vscode.TestResultState.Unset],
  ['KnownSuccess', vscode.TestResultState.Passed],
  ['KnownFail', vscode.TestResultState.Errored],
  ['KnownSkip', vscode.TestResultState.Skipped],
  ['KnownTodo', vscode.TestResultState.Unset],
]);

const isDataNode = (arg: NodeType<TestAssertionStatus>): arg is DataNode<TestAssertionStatus> =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (arg as any).data != null;

class TestBlock extends TestItemDataBase<TestBlock, TestBlock> {
  // item: vscode.TestItem<TestBlock, TestBlock>;
  // private resultState: vscode.TestResultState;
  static makeId = (fileUri: vscode.Uri, testFullName: string): string =>
    `${fileUri.fsPath}#${testFullName}`;

  constructor(
    readonly context: TestItemDataContext,
    fileUri: vscode.Uri,
    private readonly node: NodeType<TestAssertionStatus>
  ) {
    super(context, 'TestBlock');
    this.item = this.createTestItem(fileUri);
  }
  private createTestItem(fileUri: vscode.Uri) {
    const item = vscode.test.createTestItem<TestBlock>({
      id: TestBlock.makeId(fileUri, this.node.fullName),
      label: this.node.name,
      uri: fileUri,
    });

    item.data = this;
    item.status = vscode.TestItemStatus.Resolved;

    return item;
  }

  runTest(_run: vscode.TestRun<this>): Promise<boolean> {
    // TODO: run the given test in the file
    return Promise.reject('not yet implemented');
  }
  public updateWithMatchResult(testResult: TestResult): void {
    this.item.range = new vscode.Range(
      testResult.start.line,
      testResult.start.column,
      testResult.end.line,
      testResult.end.column
    );
  }

  public setResultState(run: vscode.TestRun<TestBlock>): void {
    if (!isDataNode(this.node)) {
      return;
    }
    const assertion = this.node.data;
    const state = TestResultStateMap.get(assertion.status) ?? vscode.TestResultState.Unset;
    run.setState(this.item, state);
    run.appendOutput(`updateState: "${this.item.label}": ${state} (${assertion.status})\r\n`);
    const message = assertion.shortMessage ?? assertion.terseMessage;
    if (message) {
      run.appendMessage(this.item, { message, severity: vscode.TestMessageSeverity.Error });
    }
  }
}

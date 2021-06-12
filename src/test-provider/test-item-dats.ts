import * as vscode from 'vscode';
import { TestResult } from '../TestResults/TestResult';
import { extensionId } from '../appGlobals';
import { JestExtContext } from '../JestExt';
import { TestReconciliationStateType, TestResultProvider } from '../TestResults';
import * as path from 'path';
import { JestExtRequestType, ProcessSession } from '../JestExt/process-session';
import { TestFileAssertionStatus, TestAssertionStatus } from '../../../jest-editor-support';
import { DataNode, NodeType, ROOT_NODE_NAME } from '../TestResults/match-node';
import { Logging } from '../logging';
import { MatchEventData } from '../TestResults/TestResultEvent';
import { buildAssertionContainer } from '../TestResults/match-by-context';

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
        label: 'Jest Tests',
        uri: workspaceFolder.uri,
      },
      this
    );

    item.status = vscode.TestItemStatus.Pending;
    item.resolveHandler = (token): void => {
      const events = this.context.testResolveProvider.events;
      const listeners: vscode.Disposable[] = [
        events.testListUpdated.event(this.onTestListUpdated),
        events.testAssertionUpdated.event(this.onTestAssertionUpdated),
        events.testResultMatched.event(this.onTestResultMatched),
      ];

      token.onCancellationRequested(() => {
        item.status = vscode.TestItemStatus.Pending;
        listeners.forEach((l) => l.dispose());
      });
      item.status = vscode.TestItemStatus.Resolved;
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
  private addFolder(parent: FolderData | undefined, folderName: string): FolderData {
    const p = parent ?? this;
    const parts = parent ? [...parent.pathParts, folderName] : [folderName];
    const folder = p.item.children.get(folderName)?.data ?? new FolderData(this.context, parts);
    p.item.addChild(folder.item);

    return folder as FolderData;
  }
  private addPath(absoluteFileName: string): FolderData | undefined {
    const relativePath = path.relative(this.workspaceFolder.uri.fsPath, absoluteFileName);
    const folders = relativePath.split(path.sep).slice(0, -1);

    return folders.reduce(this.addFolder, undefined);
  }
  public addTestFile(absoluteFileName: string): DocumentRoot {
    const docRoot = this.DocumentRoots.get(absoluteFileName);
    if (docRoot) {
      return docRoot;
    }
    const parent = this.addPath(absoluteFileName) ?? this;
    const documentRootItem =
      (parent.item.children.get(absoluteFileName) as DocumentRootItem) ??
      new DocumentRoot(
        this.context,
        vscode.Uri.file(absoluteFileName),
        vscode.TestItemStatus.Pending
      ).item;

    parent.item.addChild(documentRootItem);
    this.DocumentRoots.set(absoluteFileName, documentRootItem.data);

    return documentRootItem.data;
  }
  private onTestListUpdated(absoluteFileNames: string[] | undefined): void {
    if (!absoluteFileNames || absoluteFileNames.length <= 0) {
      // error or no test file...  do nothing
      this.log('debug', 'onTestListUpdated received 0 test file list');
      return;
    }
    absoluteFileNames.forEach((f) => this.addTestFile(f));
  }
  private onTestAssertionUpdated(fileAssertions: TestFileAssertionStatus[]): void {
    fileAssertions.forEach((fa) => this.addTestFile(fa.file));
  }
  private onTestResultMatched({ fileName }: MatchEventData): void {
    this.addTestFile(fileName);
  }
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
      { id: uri.fsPath, label: uri.fsPath, uri },
      this
    );

    item.runnable = !this.context.autoRun.isWatch;
    item.debuggable = true;
    item.status = itemStatus;
    item.resolveHandler = (token) => {
      const events = this.context.testResolveProvider.events;
      const listeners: vscode.Disposable[] = [
        events.testAssertionUpdated.event(this.onTestAssertionUpdated),
        events.testResultMatched.event(this.onTestResultMatched),
      ];

      token.onCancellationRequested(() => {
        item.status = vscode.TestItemStatus.Pending;
        listeners.forEach((l) => l.dispose());
      });

      item.status = vscode.TestItemStatus.Resolved;
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

  private createRun(option?: DocumentRootTestRunOption): DocumentRootRunReturn {
    const tests: vscode.TestItem<DocumentRootDataType>[] = [this.item];
    if (option?.includeTestNodes) {
      this.item.children.forEach((test) => tests.push(test));
    }
    const request: vscode.TestRunRequest<DocumentRootDataType> = { tests, debug: false };
    return { request, run: vscode.test.createTestRun(request, option?.name) };
  }
  private onTestAssertionUpdated(fileAssertions: TestFileAssertionStatus[]): void {
    const fAssertion = fileAssertions.find((fa) => fa.file === this.item.id);
    if (!fAssertion) {
      return;
    }
    this.resultState = TestResultStateMap.get(fAssertion.status) ?? vscode.TestResultState.Unset;

    const aContainer = fAssertion.assertions && buildAssertionContainer(fAssertion.assertions);
    this.item.children.forEach((item) => item.dispose());
    this.testMap.clear();

    if (!aContainer) {
      return;
    }
    this.addNode(this, aContainer);
    const { request, run } = this.createRun({ name: `onTestAssertionUpdated: ${this.item.id}` });
    request.tests.forEach((item) => item.data.setResultState(run));
  }

  private onTestResultMatched({ fileName, results }: MatchEventData): void {
    if (fileName !== this.item.id) {
      return;
    }

    // update each testBlock from matched result
    results.forEach((r) => {
      const testBlocks = this.testMap.get(r.name);
      if (!testBlocks) {
        return;
      }
      testBlocks.forEach((t) => t.updateWithMatchResult(r));
    });
  }

  public setResultState(run: vscode.TestRun<DocumentRootDataType>): void {
    run.setState(this.item, this.resultState);
  }

  private addTestBlock(fullName: string, data: TestBlock) {
    const list = this.testMap.get(fullName) ?? [];
    list.push(data);
    this.testMap.set(fullName, list);
  }

  private addNode(parentNode: TestBlock | this, node: NodeType<TestAssertionStatus>) {
    let parent = parentNode;
    if (node.name !== ROOT_NODE_NAME) {
      const child =
        parent.item.children.get(node.name)?.data ??
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        new TestBlock(this.context, this.item.uri!, node);
      this.addTestBlock(node.fullName, child);
      parent.item.addChild(child.item);
      parent = child;
    }
    if (!isDataNode(node)) {
      const nodes = [...node.childContainers, ...node.childData];
      nodes.forEach((n) => this.addNode(parent, n));
    }
    const group = node.getAll().slice(1);
    group.forEach((m) => this.addNode(parentNode, m));
  }
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
      id: this.node.fullName,
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
      testResult.start.line - 1,
      testResult.start.column - 1,
      testResult.end.line - 1,
      testResult.end.column - 1
    );
  }

  public setResultState(run: vscode.TestRun<TestBlock>): void {
    if (!isDataNode(this.node)) {
      return;
    }
    const assertion = this.node.data;
    run.setState(
      this.item,
      TestResultStateMap.get(assertion.status) ?? vscode.TestResultState.Unset
    );
    const msg: vscode.TestMessage = {
      message: assertion.shortMessage ?? assertion.terseMessage ?? 'Test Failed',
      severity: vscode.TestMessageSeverity.Error,
    };
    if (msg) {
      run.appendMessage(this.item, msg);
    }
  }
}

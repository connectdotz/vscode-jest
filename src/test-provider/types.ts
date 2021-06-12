// type MarkdownTestData = WorkspaceTestRoot | DocumentTestRoot | TestFile | TestHeading | TestCase;
export type TestControllerData = WorkspaceRoot | DocumentRoot | FolderData | TestBlock;

export type MessageType = { type: 'failed-to-create-item'; msg: string };
export interface TestControllData<T, TChild> {
  item: vscode.TestItem<T, TChild>;
  runTest: (run: vscode.TestRun<T>) => Promise<boolean>;
}

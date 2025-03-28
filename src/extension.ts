import * as vscode from "vscode";
import { window } from "vscode";
import { ManimShell, NoActiveShellError } from "./manimShell";
import { ManimCell } from "./manimCell";
import { previewManimCell, reloadAndPreviewManimCell, previewCode } from "./previewCode";
import { startScene, exitScene } from "./startStopScene";
import { exportScene } from "./export";
import { Logger, Window, LogRecorder } from "./logger";
import { registerWalkthroughCommands } from "./walkthrough";
import { ExportSceneCodeLens } from "./export";
import { determineManimVersion } from "./manimVersion";
import { setupTestEnvironment } from "./utils/testing";
import { EventEmitter } from "events";
import { applyWindowsPastePatch } from "./patches/applyPatches";
import { getBinaryPathInPythonEnv } from "./utils/venv";

export let manimNotebookContext: vscode.ExtensionContext;

export async function activate(context: vscode.ExtensionContext) {
  if (process.env.IS_TESTING === "true") {
    console.log("💠 Setting up test environment");
    Logger.info("💠 Setting up test environment");
    setupTestEnvironment();
  } else {
    console.log("💠 Not setting up test environment");
  }

  manimNotebookContext = context;

  // Trigger the Manim shell to start listening to the terminal
  ManimShell.instance;

  // Register the open walkthrough command earlier, so that it can be used
  // even while other activation tasks are still running
  const openWalkthroughCommand = vscode.commands.registerCommand(
    "manim-notebook.openWalkthrough", async () => {
      Logger.info("💠 Command requested: Open Walkthrough");
      await vscode.commands.executeCommand("workbench.action.openWalkthrough",
        `${context.extension.id}#manim-notebook-walkthrough`, false);
    });
  context.subscriptions.push(openWalkthroughCommand);

  let pythonBinary: string;
  try {
    waitForPythonExtension().then((pythonEnvPath: string | undefined) => {
      // (These tasks here can be performed in the background)

      // also see https://github.com/Manim-Notebook/manim-notebook/pull/117#discussion_r1932764875
      const pythonBin = process.platform === "win32" ? "python" : "python3";
      pythonBinary = pythonEnvPath
        ? getBinaryPathInPythonEnv(pythonEnvPath, pythonBin)
        : pythonBin;

      if (process.platform === "win32") {
        applyWindowsPastePatch(context, pythonBinary);
      }

      determineManimVersion(pythonBinary);
    });
  } catch (err) {
    Logger.error("Error in background activation processing"
      + ` (python extension waiting, windows paste patch or manim version check): ${err}`);
  }

  const previewManimCellCommand = vscode.commands.registerCommand(
    "manim-notebook.previewManimCell", (cellCode?: string, startLine?: number) => {
      Logger.info(`💠 Command requested: Preview Manim Cell, startLine=${startLine}`);
      previewManimCell(cellCode, startLine);
    });

  const reloadAndPreviewManimCellCommand = vscode.commands.registerCommand(
    "manim-notebook.reloadAndPreviewManimCell",
    (cellCode?: string, startLine?: number) => {
      Logger.info("💠 Command requested: Reload & Preview Manim Cell"
        + `, startLine=${startLine}`);
      reloadAndPreviewManimCell(cellCode, startLine);
    });

  const previewSelectionCommand = vscode.commands.registerCommand(
    "manim-notebook.previewSelection", () => {
      Logger.info("💠 Command requested: Preview Selection");
      previewSelection();
    },
  );

  const startSceneCommand = vscode.commands.registerCommand(
    "manim-notebook.startScene", () => {
      Logger.info("💠 Command requested: Start Scene");
      startScene();
    },
  );

  const exitSceneCommand = vscode.commands.registerCommand(
    "manim-notebook.exitScene", () => {
      Logger.info("💠 Command requested: Exit Scene");
      exitScene();
    },
  );

  const clearSceneCommand = vscode.commands.registerCommand(
    "manim-notebook.clearScene", () => {
      Logger.info("💠 Command requested: Clear Scene");
      clearScene();
    },
  );

  const recordLogFileCommand = vscode.commands.registerCommand(
    "manim-notebook.recordLogFile", async () => {
      Logger.info("💠 Command requested: Record Log File");
      await LogRecorder.recordLogFile(context);
    });

  const exportSceneCommand = vscode.commands.registerCommand(
    "manim-notebook.exportScene", async (sceneName?: string) => {
      Logger.info("💠 Command requested: Export Scene");
      await exportScene(sceneName);
    });
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: "python" }, new ExportSceneCodeLens()),
  );

  // internal command
  const finishRecordingLogFileCommand = vscode.commands.registerCommand(
    "manim-notebook.finishRecordingLogFile", async () => {
      Logger.info("💠 Command requested: Finish Recording Log File");
      await LogRecorder.finishRecordingLogFile(context);
    });

  const redetectManimVersionCommand = vscode.commands.registerCommand(
    "manim-notebook.redetectManimVersion", async () => {
      Logger.info("💠 Command requested: Redetect Manim Version");
      if (!pythonBinary) {
        Window.showWarningMessage("Please wait for Manim Notebook to have finished activating.");
        return;
      }
      await determineManimVersion(pythonBinary);
    });

  registerWalkthroughCommands(context);

  context.subscriptions.push(
    previewManimCellCommand,
    previewSelectionCommand,
    reloadAndPreviewManimCellCommand,
    startSceneCommand,
    exitSceneCommand,
    clearSceneCommand,
    recordLogFileCommand,
    exportSceneCommand,
    finishRecordingLogFileCommand,
    redetectManimVersionCommand,
  );
  registerManimCellProviders(context);

  if (process.env.IS_TESTING === "true") {
    console.log("💠 Extension marked as activated");
    activatedEmitter.emit("activated");
  }
}

/**
 * Waits for the Microsoft Python extension to be activated, in case it is
 * installed.
 *
 * @returns The path to the Python environment, if it is available.
 */
async function waitForPythonExtension(): Promise<string | undefined> {
  const pythonExtension = vscode.extensions.getExtension("ms-python.python");
  if (!pythonExtension) {
    Logger.info("💠 Python extension not installed");
    return;
  }

  // Waiting for Python extension
  const pythonApi = await pythonExtension.activate();
  Logger.info("💠 Python extension activated");

  // Path to venv
  const environmentPath = pythonApi.environments.getActiveEnvironmentPath();
  if (!environmentPath) {
    Logger.debug("No active environment path found");
    return;
  }
  const environment = await pythonApi.environments.resolveEnvironment(environmentPath);
  if (!environment) {
    Logger.debug("Environment could not be resolved");
    return;
  }

  return environment.path;
}

/**
 * A global event emitter that can be used to listen for the extension being
 * activated. This is only used for testing purposes.
 */
class GlobalEventEmitter extends EventEmitter {}
export const activatedEmitter = new GlobalEventEmitter();

export function deactivate() {
  Logger.deactivate();
  Logger.info("💠 Manim Notebook extension deactivated");
}

/**
 * Previews the selected code.
 *
 * - both ends of the selection automatically extend to the start & end of lines
 *   (for convenience)
 * - if Multi-Cursor selection:
 *   only the first selection is considered
 *   (TODO: make all selections be considered - expand at each selection)
 *
 * If Manim isn't running, it will be automatically started
 * (before the first selected line).
 */
async function previewSelection() {
  const editor = window.activeTextEditor;
  if (!editor) {
    Window.showErrorMessage("Select some code to preview.");
    return;
  }

  let selectedText;
  const selection = editor.selection;
  if (selection.isEmpty) {
    // If nothing is selected - select the whole line
    const line = editor.document.lineAt(selection.start.line);
    selectedText = editor.document.getText(line.range);
  } else {
    // If selected - extend selection to start and end of lines
    const range = new vscode.Range(
      editor.document.lineAt(selection.start.line).range.start,
      editor.document.lineAt(selection.end.line).range.end,
    );
    selectedText = editor.document.getText(range);
  }

  if (!selectedText) {
    Window.showErrorMessage("Select some code to preview.");
    return;
  }

  await previewCode(selectedText, selection.start.line);
}

/**
 * Runs the `clear()` command in the terminal -
 * removes all objects from the scene.
 */
async function clearScene() {
  try {
    await ManimShell.instance.executeIPythonCommandExpectSession("clear()");
  } catch (error) {
    if (error instanceof NoActiveShellError) {
      Window.showWarningMessage("No active Manim session found to remove objects from.");
      return;
    }
    Logger.error(`💥 Error while trying to remove objects from scene: ${error}`);
    throw error;
  }
}

/**
 * Registers the Manim cell "providers", e.g. code lenses and folding ranges.
 */
function registerManimCellProviders(context: vscode.ExtensionContext) {
  const manimCell = new ManimCell();

  const codeLensProvider = vscode.languages.registerCodeLensProvider(
    { language: "python" }, manimCell);
  const foldingRangeProvider = vscode.languages.registerFoldingRangeProvider(
    { language: "python" }, manimCell);
  context.subscriptions.push(codeLensProvider, foldingRangeProvider);

  window.onDidChangeActiveTextEditor((editor) => {
    if (editor) {
      manimCell.applyCellDecorations(editor);
    }
  }, null, context.subscriptions);

  vscode.workspace.onDidChangeTextDocument((event) => {
    const editor = window.activeTextEditor;
    if (editor && event.document === editor.document) {
      manimCell.applyCellDecorations(editor);
    }
  }, null, context.subscriptions);

  window.onDidChangeTextEditorSelection((event) => {
    manimCell.applyCellDecorations(event.textEditor);
  }, null, context.subscriptions);

  if (window.activeTextEditor) {
    manimCell.applyCellDecorations(window.activeTextEditor);
  }
}

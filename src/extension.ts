import * as vscode from "vscode";
import { BuildSystem } from "./latex/buildSystem/builder";
import { PDFViewer } from "./latex/pdf/PDFViewer";
import { Logger } from "./utils/Logger";

let logger: Logger = Logger.instance;
let buildSystem: BuildSystem | null = null;

/**
 * Entry point for the extension
 * @param context Extension context
 */
export async function activate(context: vscode.ExtensionContext) {
	// Initialize output channel and logger
	Logger.initialize();
	logger.info("InTeX extension activating...");

	try {
		// Initialize the build system
		buildSystem = new BuildSystem(context);
		await buildSystem.activate();
		logger.info("Build system initialized");
	} catch (error) {
		logger.error(`Failed to initialize build system: ${error}`);
		vscode.window.showErrorMessage(`InTeX: Failed to initialize build system. ${error}`);
	}
	
	// Register the custom PDF viewer
	context.subscriptions.push(PDFViewer.register(context));

	// Register open PDF command
	context.subscriptions.push(
		vscode.commands.registerCommand('intex.openPdf', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== 'latex') {
				vscode.window.showWarningMessage('No active LaTeX document');
				return;
			}

			const docPath = editor.document.uri.fsPath;
			const pdfPath = docPath.replace(/\.tex$/, '.pdf');
			const pdfUri = vscode.Uri.file(pdfPath);

			if (PDFViewer.isOpen(pdfUri)) {
				await PDFViewer.reload(pdfUri);
			} else {
				await PDFViewer.open(pdfUri);
			}
		})
	);

	logger.info("InTeX extension activated successfully");
}

/**
 * Cleanup when extension deactivates
 */
export async function deactivate() {
	logger.info("InTeX extension deactivating...");
	if (buildSystem) {
		await buildSystem.deactivate();
	}
	logger.hide();
}


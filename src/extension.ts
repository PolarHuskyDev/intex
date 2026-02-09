import * as vscode from "vscode";
import { BuildSystem } from "./latex/buildSystem/builder";
import { PDFViewer } from "./latex/pdf/PDFViewer";
import { SyncTexHandler } from "./latex/synctex/synctexHandler";
import { Logger } from "./utils/Logger";

let logger: Logger = Logger.instance;
let buildSystem: BuildSystem | null = null;
let syncTexHandler: SyncTexHandler | null = null;

/**
 * Entry point for the extension
 * @param context Extension context
 */
export async function activate(context: vscode.ExtensionContext) {
	// Initialize output channel and logger
	Logger.initialize();
	logger.info("InTeX extension activating...");

	try {
		// =====================================
		// Initialize the build system
		// =====================================
		buildSystem = new BuildSystem(context);
		await buildSystem.activate();
		logger.info("Build system initialized");
	} catch (error) {
		logger.error(`Failed to initialize build system: ${error}`);
		vscode.window.showErrorMessage(`InTeX: Failed to initialize build system. ${error}`);
	}

	// =====================================
	// Initialize SyncTeX handler
	// =====================================
	syncTexHandler = new SyncTexHandler(context);
	if (buildSystem) {
		syncTexHandler.setBuildMethodResolver(
			() => buildSystem!.resolvedBuildMethod,
		);
	}
	syncTexHandler.registerCommands();

	// =====================================
	// Register the custom PDF viewer
	// =====================================
	context.subscriptions.push(PDFViewer.register(context));

	
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


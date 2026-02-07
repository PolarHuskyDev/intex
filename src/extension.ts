import * as vscode from "vscode";
import { BuildSystem } from "./latex/buildSystem/builder";
import { PDFViewer } from "./latex/pdf/PDFViewer";
import { Logger } from "./utils/Logger";
import { IExtensionModule } from "./interfaces/IExtensionModule";

let logger: Logger = Logger.instance;

/**
 * Entry point for the extension
 * @param context Extension context
 */
export async function activate(context: vscode.ExtensionContext) {
	// Initialize output channel and logger
	logger.info("InTeX extension activating...");

	// Register the custom PDF viewer
	context.subscriptions.push(PDFViewer.register(context));

	let extensionModules: IExtensionModule[] = [];
	extensionModules.push(new BuildSystem(context));

	

	for (const module of extensionModules) {
		await module.activate();
	}

	
	logger.info("InTeX extension activated successfully");
}

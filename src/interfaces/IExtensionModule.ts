import * as vscode from "vscode";


export interface IExtensionModule {
	/**
	 * Activate the extension module
	 */
	activate(): Promise<void>;

	/**
	 * Deactivate the extension module
	 */
	deactivate(): Promise<void>;
}

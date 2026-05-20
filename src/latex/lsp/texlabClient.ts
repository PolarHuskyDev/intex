import * as vscode from "vscode";
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	Executable,
	DocumentFormattingRequest,
	DocumentFormattingParams,
} from "vscode-languageclient/node";
import { Logger } from "../../utils/logger";
import { TexlabManager } from "./texlabManager";
import { TexlabInstaller } from "./texlabInstaller";

import { Config } from "../../utils/config";

export class TexlabClient {
	private client: LanguageClient | null = null;
	private manager: TexlabManager;
	private installer: TexlabInstaller;
	private logger = Logger.instance;
	private context: vscode.ExtensionContext;

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
		this.manager = new TexlabManager(context);
		this.installer = new TexlabInstaller(context);
	}

	/**
	 * Initialize the texlab LSP subsystem.
	 * Installs if needed, and starts the client.
	 */
	async initialize(): Promise<void> {
		this.registerCommands();

		if (!Config.instance.lspEnabled) {
			this.logger.info("texlab LSP disabled by configuration");
			return;
		}

		try {
			if (await this.installer.isInstalled()) {
				await this.start();
				this.logger.info("texlab LSP client started");
			} else {
				// Prompt to install in the background (non-blocking)
				this.installer.promptInstallIfNeeded();
			}
		} catch (error) {
			this.logger.error(`Failed to initialize texlab LSP: ${error}`);
		}
	}

	private registerCommands(): void {
		this.context.subscriptions.push(
			vscode.commands.registerCommand("intex.formatDocument", async () => {
				const editor = vscode.window.activeTextEditor;
				if (!editor) return;

				if (!this.isActive()) {
					this.logger.warn("texlab is not running, cannot format document");
					vscode.window.showWarningMessage(
						"InTeX: texlab is not running. Enable the LSP (intex.lsp.enabled) to use formatting.",
					);
					return;
				}

				this.logger.info(`Formatting document: ${editor.document.uri.toString()}`);
				const edits = await this.formatDocument(editor.document, {
					tabSize: editor.options.tabSize as number,
					insertSpaces: editor.options.insertSpaces as boolean,
				});

				if (edits.length > 0) {
					const wsEdit = new vscode.WorkspaceEdit();
					wsEdit.set(editor.document.uri, edits);
					await vscode.workspace.applyEdit(wsEdit);
					this.logger.info(`Document formatted: ${editor.document.uri.toString()}, edits applied: ${edits.length}`);
				} else {
					this.logger.info(`Document formatted: ${editor.document.uri.toString()}, no edits needed`);
				}
			}),
		);
	}

	private async start(): Promise<void> {
		try {
			// Check if texlab is available
			const texlabPath = await this.manager.getTexlabPath();

			if (!texlabPath) {
				this.logger.warn("texlab binary not found. LSP features disabled.");
				return;
			}

			this.logger.info(`Found texlab at: ${texlabPath}`);

			// Configure the server
			const serverOptions: ServerOptions = {
				run: { command: texlabPath } as Executable,
				debug: { command: texlabPath } as Executable,
			};

			// Configure the client
			const clientOptions: LanguageClientOptions = {
				documentSelector: [
					{ scheme: "file", language: "latex" },
					{ scheme: "file", language: "bibtex" },
				],
				synchronize: {
					fileEvents: [
						vscode.workspace.createFileSystemWatcher("**/*.tex"),
						vscode.workspace.createFileSystemWatcher("**/*.bib"),
						vscode.workspace.createFileSystemWatcher("**/*.aux"),
					],
				},
				initializationOptions: {
					build: {
						// We handle builds ourselves - auto/local/docker and build on save logic is handled by our extension,
						// so disable texlab's built in build on save to avoid conflicts
						onSave: false,
						forwardSearchAfter: false, // We handle SyncTeX ourselves
					},
					chktex: {
						// disables chktex linting and use only diagnostics from texlab, which are more comprehensive.
						// TODO: consider making this configurable if users want chktex linting in addition to texlab diagnostics
						onEdit: false,
						onOpenAndSave: false,
					},
					latexFormatter: Config.instance.formattingLatexFormatter,
					bibtexFormatter: Config.instance.formattingBibtexFormatter,
					formatterLineLength: Config.instance.formattingLineLength,
				},
				outputChannel: this.logger.channel,
			};

			// Create the language client
			this.client = new LanguageClient(
				"texlab",
				"TeXLab Language Server",
				serverOptions,
				clientOptions,
			);

			// Start the client
			await this.client.start();
		} catch (error) {
			this.logger.error(`Failed to start texlab: ${error}`);
			// Don't show error window here to avoid annoyance if it fails silently
		}
	}

	async stop(): Promise<void> {
		if (this.client) {
			await this.client.stop();
			this.client = null;
			this.logger.info("texlab LSP server stopped");
		}
	}

	getClient(): LanguageClient | null {
		return this.client;
	}

	isActive(): boolean {
		return this.client !== null;
	}

	async formatDocument(
		document: vscode.TextDocument,
		options: vscode.FormattingOptions,
	): Promise<vscode.TextEdit[]> {
		if (!this.client) {
			this.logger.warn("texlab is not running, cannot format document");
			return [];
		}

		try {
			const params: DocumentFormattingParams = {
				textDocument: { uri: document.uri.toString() },
				options: {
					tabSize: options.tabSize,
					insertSpaces: options.insertSpaces,
				},
			};
			const edits = await this.client.sendRequest(
				DocumentFormattingRequest.type,
				params,
			);
			if (!edits) return [];
			return this.client.protocol2CodeConverter.asTextEdits(edits);
		} catch (error) {
			this.logger.error(`Format document failed: ${error}`);
			return [];
		}
	}
}

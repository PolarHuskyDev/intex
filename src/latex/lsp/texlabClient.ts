import * as vscode from "vscode";
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	Executable,
} from "vscode-languageclient/node";
import { Logger } from "../../utils/Logger";
import { TexlabManager } from "./texlabManager";
import { TexlabInstaller } from "./texlabInstaller";

export class TexlabClient {
	private client: LanguageClient | null = null;
	private manager: TexlabManager;
	private installer: TexlabInstaller;
	private logger = Logger.instance;

	constructor(
		context: vscode.ExtensionContext,
	) {
		this.manager = new TexlabManager(context);
		this.installer = new TexlabInstaller(context);
	}

	/**
	 * Initialize the texlab LSP subsystem.
	 * Installs if needed, and starts the client.
	 */
	async initialize(): Promise<void> {
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
						executable: "latexmk",
						args: ["-pdf", "-interaction=nonstopmode", "-synctex=1", "%f"],
						onSave: false, // We handle this ourselves
						forwardSearchAfter: false,
					},
					chktex: {
						onEdit: false,
						onOpenAndSave: false,
					},
					diagnosticsDelay: 300,
					formatterLineLength: 80,
					latexFormatter: "latexindent",
					latexindent: {
						local: null,
						modifyLineBreaks: false,
					},
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
}

import * as vscode from "vscode";
import * as path from "path";
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	Executable,
} from "vscode-languageclient/node";
import { Logger } from "../../utils/Logger";
import { TexlabManager } from "./texlabManager";

export class TexlabClient {
	private client: LanguageClient | null = null;
	private manager: TexlabManager;

	constructor(
		private context: vscode.ExtensionContext,
		private logger: Logger,
	) {
		this.manager = new TexlabManager(context, logger);
	}

	async start(): Promise<void> {
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
			this.logger.info("texlab LSP server started successfully");
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

import * as vscode from "vscode";
import { Config } from "../../utils/Config";
import { Logger } from "../../utils/Logger";
import { EnvironmentDetector } from "./detector";
import { LocalBuilder } from "./localBuilder";
import { DockerBuilder } from "./dockerBuilder";
import { IExtensionModule } from "../../interfaces/IExtensionModule";

export interface IBuilder {
	build(documentUri: vscode.Uri): Promise<BuildResult>;
	clean(documentUri: vscode.Uri): Promise<void>;
	isAvailable(): Promise<boolean>;
	getName(): string;
}

export interface BuildResult {
	success: boolean;
	output: string;
	errors: BuildError[];
	pdfPath?: string;
}

export interface BuildError {
	file: string;
	line: number;
	message: string;
	severity: "error" | "warning";
}

export class BuildSystem implements IExtensionModule {
	private builder: IBuilder | null = null;
	private detector: EnvironmentDetector;
	private config = Config.instance;
	private logger = Logger.instance;

	constructor(private context: vscode.ExtensionContext) {
		this.detector = new EnvironmentDetector();
	}

	registerCommands() {
		// Clean command
		this.context.subscriptions.push(
			vscode.commands.registerCommand('intex.clean', async () => {
				const editor = vscode.window.activeTextEditor;
				if (!editor || editor.document.languageId !== 'latex') {
					vscode.window.showWarningMessage('No active LaTeX document');
					return;
				}
				
				await this.clean(editor.document.uri);
				vscode.window.showInformationMessage('Auxiliary files cleaned');
			})
		);
	}

	async activate(): Promise<void> {
		try {
			await this.initialize();
			this.registerCommands();
		} catch (error) {
			this.logger.error(`Failed to initialize build system: ${error}`);
			vscode.window.showErrorMessage(`InTeX: Failed to initialize build system. ${error}`);
		}
	}
	
	async deactivate(): Promise<void> {
		this.logger.info("Build system deactivating...");
		this.builder = null;
	}

	async initialize(): Promise<void> {
		const buildMethod = this.config.buildMethod;
		this.logger.info(`Initializing build system with method: ${buildMethod}`);

		// Handle explicit build method selection
		if (buildMethod === "local") {
			this.builder = new LocalBuilder();
			await this.validateBuilder();
			return;
		}

		if (buildMethod === "docker") {
			this.builder = new DockerBuilder();
			await this.validateBuilder();
			return;
		}

		// Auto-detect build environment
		const hasLocal = await this.detector.hasLocalTexLive();
		if (hasLocal) {
			this.logger.info("Local TeX Live detected, using local builder");
			this.builder = new LocalBuilder();
			await this.validateBuilder();
			return;
		}

		const hasDocker = await this.detector.hasDocker();
		if (hasDocker) {
			this.logger.info("Docker detected, using Docker builder");
			this.builder = new DockerBuilder();
			await this.validateBuilder();
			return;
		}

		// No LaTeX environment found
		this.logger.error("No LaTeX environment found!");
		vscode.window.showErrorMessage(
			"No LaTeX environment detected. Please install TeX Live or Docker.",
		);
	}

	private async validateBuilder(): Promise<void> {
		if (!this.builder) {
			return;
		}

		const available = await this.builder.isAvailable();
		if (!available) {
			this.logger.warn(
				`Selected builder ${this.builder.getName()} is not available`,
			);
			vscode.window.showWarningMessage(
				`Selected build method (${this.builder.getName()}) is not available`,
			);
			return;
		}

		this.logger.info("Build system initialized successfully");
	}

	async build(documentUri: vscode.Uri): Promise<BuildResult> {
		if (!this.builder) {
			throw new Error("Build system not initialized");
		}

		return await this.builder.build(documentUri);
	}

	async clean(documentUri: vscode.Uri): Promise<void> {
		if (!this.builder) {
			throw new Error("Build system not initialized");
		}

		await this.builder.clean(documentUri);
	}

	async getEnvironmentInfo(): Promise<string> {
		const hasLocal = await this.detector.hasLocalTexLive();
		const hasDocker = await this.detector.hasDocker();
		const localVersion = hasLocal
			? await this.detector.getTexLiveVersion()
			: "N/A";
		const dockerVersion = hasDocker
			? await this.detector.getDockerVersion()
			: "N/A";

		const currentBuilder = this.builder ? this.builder.getName() : "None";

		return [
			`Current Builder: ${currentBuilder}`,
			`Local TeX Live: ${hasLocal ? "Yes" : "No"} (${localVersion})`,
			`Docker: ${hasDocker ? "Yes" : "No"} (${dockerVersion})`,
		].join("\n");
	}
}

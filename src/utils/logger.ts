import * as vscode from "vscode";

export class Logger {
	private static _instance: Logger | null = null;
	private static outputChannel: vscode.OutputChannel | null = null;

	private constructor() {}

	public static get instance(): Logger {
		if (!Logger._instance) {
			Logger._instance = new Logger();
		}
		return Logger._instance;
	}

	public static initialize(outputChannel?: vscode.OutputChannel) {
		if (outputChannel) {
			Logger.outputChannel = outputChannel;
		} else if (!Logger.outputChannel) {
			Logger.outputChannel = vscode.window.createOutputChannel("InTeX");
		}
	}

	public get channel(): vscode.OutputChannel {
		if (!Logger.outputChannel) {
			Logger.outputChannel = vscode.window.createOutputChannel("InTeX");
		}
		return Logger.outputChannel;
	}

	info(message: string): void {
		const timestamp = new Date().toISOString();
		this.channel.appendLine(`[${timestamp}] [INFO] ${message}`);
	}

	warn(message: string): void {
		const timestamp = new Date().toISOString();
		this.channel.appendLine(`[${timestamp}] [WARN] ${message}`);
	}

	error(message: string): void {
		const timestamp = new Date().toISOString();
		this.channel.appendLine(`[${timestamp}] [ERROR] ${message}`);
	}

	show(): void {
		this.channel.show();
	}

	hide(): void {
		this.channel.hide();
	}
}

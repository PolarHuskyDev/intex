import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as child_process from "child_process";
import { Logger } from "../../utils/Logger";

export class TexlabManager {
	private readonly globalStoragePath: string;
	private readonly binName: string;
	private logger = Logger.instance;

	constructor(
		context: vscode.ExtensionContext
	) {
		this.globalStoragePath = context.globalStorageUri.fsPath;
		this.binName = process.platform === "win32" ? "texlab.exe" : "texlab";
	}

	/**
	 * Get the resolved path to the texlab binary managed by the extension.
	 * Only uses the binary downloaded to global storage.
	 */
	public async getTexlabPath(): Promise<string | null> {
		const storagePath = path.join(this.globalStoragePath, this.binName);
		if (await this.fileExists(storagePath)) {
			return storagePath;
		}

		return null;
	}

	public getDownloadTarget(): string {
		return path.join(this.globalStoragePath, this.binName);
	}

	public getGlobalStoragePath(): string {
		return this.globalStoragePath;
	}

	/**
	 * Check if texlab is installed via any method
	 */
	public async isInstalled(): Promise<boolean> {
		return (await this.getTexlabPath()) !== null;
	}

	/**
	 * Get the version of the resolved texlab binary
	 */
	public async getInstalledVersion(): Promise<string | null> {
		const texlabPath = await this.getTexlabPath();
		if (!texlabPath) {
			this.logger.warn("texlab binary not found when checking version");
			return null;
		}

		try {
			const output = child_process.execSync(`"${texlabPath}" --version`, {
				timeout: 5000,
				encoding: "utf8",
			});
			const match = output.match(/texlab (\d+\.\d+\.\d+)/);
			return match ? match[1] : null;
		} catch (error) {
			this.logger.error(`Failed to get texlab version: ${error}`);
			return null;
		}
	}

	private async fileExists(filePath: string): Promise<boolean> {
		try {
			await fs.promises.access(filePath);
			return true;
		} catch {
			return false;
		}
	}
}

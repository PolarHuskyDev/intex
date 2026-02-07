import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as child_process from "child_process";
import { Logger } from "../../utils/Logger";

export class TexlabManager {
	private readonly globalStoragePath: string;
	private readonly binName: string;

	constructor(
		private context: vscode.ExtensionContext,
		private logger?: Logger,
	) {
		this.globalStoragePath = context.globalStorageUri.fsPath;
		this.binName = process.platform === "win32" ? "texlab.exe" : "texlab";
	}

	/**
	 * Get the resolved path to the texlab binary.
	 * Priority:
	 * 1. VS Code configuration (intex.texlab.path)
	 * 2. Global storage (downloaded by extension)
	 * 3. Bundled binary (legacy support)
	 * 4. PATH environment variable
	 */
	public async getTexlabPath(): Promise<string | null> {
		// 1. Check configuration
		const config = vscode.workspace.getConfiguration("intex");
		const customPath = config.get<string>("texlab.path");
		if (customPath && (await this.fileExists(customPath))) {
			this.logger?.info(`Using configured texlab path: ${customPath}`);
			return customPath;
		}

		// 2. Check global storage (preferred download location)
		const storagePath = path.join(this.globalStoragePath, this.binName);
		if (await this.fileExists(storagePath)) {
			this.logger?.info(`Using downloaded texlab path: ${storagePath}`);
			return storagePath;
		}

		// 3. Check PATH
		const pathBinary = await this.findInPath();
		if (pathBinary) {
			this.logger?.info(`Using system texlab path: ${pathBinary}`);
			return pathBinary;
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
			this.logger?.error(`Failed to get texlab version: ${error}`);
			return null;
		}
	}

	private async findInPath(): Promise<string | null> {
		try {
			const { execFile } = require("child_process");
			const { promisify } = require("util");
			const execFileAsync = promisify(execFile);

			const isWindows = process.platform === "win32";
			const command = isWindows ? "where" : "which";

			try {
				const { stdout } = await execFileAsync(command, ["texlab"]);
				const texlabPath = stdout.trim().split("\n")[0];
				if (texlabPath && (await this.fileExists(texlabPath.trim()))) {
					return texlabPath.trim();
				}
			} catch {
				// Not in PATH
			}
			return null;
		} catch {
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

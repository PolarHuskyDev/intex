import { exec } from "child_process";
import { promisify } from "util";
import { Logger } from "../../utils/Logger";

const execAsync = promisify(exec);

export class EnvironmentDetector {
	private readonly TIMEOUT = 5000; // 5 second timeout
	private logger = Logger.instance;

	constructor() {}

	async hasLocalTexLive(): Promise<boolean> {
		try {
			await execAsync("pdflatex --version", { timeout: this.TIMEOUT });
			return true;
		} catch {
			return false;
		}
	}

	async hasDocker(): Promise<boolean> {
		try {
			await execAsync("docker --version", { timeout: this.TIMEOUT });
			return true;
		} catch {
			return false;
		}
	}

	async getTexLiveVersion(): Promise<string> {
		try {
			const { stdout } = await execAsync("pdflatex --version", {
				timeout: this.TIMEOUT,
			});
			const match = stdout.match(/TeX Live (\d+)/);
			return match ? match[1] : "Unknown";
		} catch {
			return "Unknown";
		}
	}

	async getDockerVersion(): Promise<string> {
		try {
			const { stdout } = await execAsync("docker --version", {
				timeout: this.TIMEOUT,
			});
			const match = stdout.match(/Docker version ([\d.]+)/);
			return match ? match[1] : "Unknown";
		} catch {
			return "Unknown";
		}
	}

	async hasLatexmk(): Promise<boolean> {
		try {
			await execAsync("latexmk --version", { timeout: this.TIMEOUT });
			return true;
		} catch {
			return false;
		}
	}
}

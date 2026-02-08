import * as vscode from "vscode";

export class Config {
	private static _instance: Config;
	private config: vscode.WorkspaceConfiguration;

	private constructor() {
		this.config = vscode.workspace.getConfiguration("intex");
	}

	static get instance(): Config {
		if (!Config._instance) {
			Config._instance = new Config();
		}
		return Config._instance;
	}

	refresh(): void {
		this.config = vscode.workspace.getConfiguration("intex");
	}

	get buildMethod(): "auto" | "local" | "docker" {
		return this.config.get<"auto" | "local" | "docker">("buildMethod", "auto");
	}

	get dockerImage(): string {
		return this.config.get<string>("docker.image", "texlive/texlive:latest");
	}

	get dockerUserShift(): boolean {
		return this.config.get<boolean>("docker.userShift", true);
	}

	get dockerEnableCache(): boolean {
		return this.config.get<boolean>("docker.enableCache", true);
	}

	get buildOnSave(): boolean {
		return this.config.get<boolean>("buildOnSave", true);
	}

	get buildEngine(): string {
		return this.config.get<string>("buildEngine", "latexmk");
	}

	get latexmkOptions(): string[] {
		return this.config.get<string[]>("latexmk.options", [
			"-pdf",
			"-interaction=nonstopmode",
			"-synctex=1",
			"-file-line-error",
		]);
	}

	get outputDirectory(): string {
		return this.config.get<string>("outputDirectory", "out");
	}

	get rootFile(): string {
		return this.config.get<string>("rootFile", "");
	}

	get showOutputChannel(): "never" | "onError" | "always" {
		return this.config.get<"never" | "onError" | "always">(
			"showOutputChannel",
			"onError",
		);
	}

	// Generic get method
	// getValue<T>(key: string): T | undefined;
	// getValue<T>(key: string, defaultValue: T): T;
	// getValue<T>(key: string, defaultValue?: T): T | undefined {
	// 	return this.config.get<T>(key, defaultValue as any);
	// }

	// Generic update method
	// async update(
	// 	key: string,
	// 	value: any,
	// 	target?: vscode.ConfigurationTarget,
	// ): Promise<void> {
	// 	await this.config.update(key, value, target);
	// 	this.refresh(); // Refresh config after update
	// }
}

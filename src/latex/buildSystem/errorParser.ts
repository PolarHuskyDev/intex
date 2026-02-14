import { BuildError } from "./builder";

export class ErrorParser {
	/**
	 * Parse LaTeX log output and extract errors and warnings
	 */
	parse(output: string): BuildError[] {
		const errors: BuildError[] = [];
		const lines = output.split("\n");

		// LaTeX error pattern: ./file.tex:123: Error message
		const errorPattern = /^(?:\.\/)?(.+?):(\d+):\s*(.+)$/;

		// LaTeX warning pattern
		const warningPattern = /^(?:LaTeX|Package)\s+(\w+)?\s*Warning:\s*(.+)$/i;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// Check for errors
			const errorMatch = line.match(errorPattern);
			if (errorMatch) {
				const [, file, lineNum, message] = errorMatch;

				// Get additional context from next lines if available
				let fullMessage = message;
				let j = i + 1;
				while (j < lines.length && lines[j].startsWith(" ")) {
					fullMessage += " " + lines[j].trim();
					j++;
				}

				errors.push({
					file: file.trim(),
					line: parseInt(lineNum, 10),
					message: fullMessage.trim(),
					severity: "error",
				});
				continue;
			}

			// Check for warnings
			const warningMatch = line.match(warningPattern);
			if (warningMatch) {
				const [, pkg, message] = warningMatch;

				// Try to extract file and line number from warning
				const file = "unknown";
				let lineNum = 0;

				// Some warnings include file info like: on input line 123
				const lineInfo = message.match(/on input line (\d+)/);
				if (lineInfo) {
					lineNum = parseInt(lineInfo[1], 10);
				}

				errors.push({
					file,
					line: lineNum,
					message: message.trim(),
					severity: "warning",
				});
			}

			// Check for common error indicators
			if (
				line.includes("! LaTeX Error:") ||
				line.includes("! Undefined control sequence")
			) {
				// Extract file and line from previous lines
				let file = "unknown";
				const lineNum = 0;

				for (let k = i - 1; k >= Math.max(0, i - 10); k--) {
					const prevLine = lines[k];
					const fileMatch = prevLine.match(/\(\.\/(.+?)$/);
					if (fileMatch) {
						file = fileMatch[1];
						break;
					}
				}

				const errorMessage = line.substring(2); // Remove "! "
				errors.push({
					file,
					line: lineNum,
					message: errorMessage.trim(),
					severity: "error",
				});
			}
		}

		return errors;
	}
}

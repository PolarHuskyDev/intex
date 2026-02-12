// ============================================================
// InTeX Equation Editor — live KaTeX preview + symbol toolbar
// ============================================================
(function () {
	"use strict";

	const vscode = acquireVsCodeApi();

	const latexInput = document.getElementById("latexInput");
	const katexOutput = document.getElementById("katexOutput");
	const errorOutput = document.getElementById("errorOutput");
	const symbolsToolbar = document.getElementById("symbolsToolbar");
	const envSelect = document.getElementById("envSelect");
	const labelInput = document.getElementById("labelInput");

	// ── Set initial env type from server ──
	if (window.__INITIAL_ENV_TYPE__) {
		envSelect.value = window.__INITIAL_ENV_TYPE__;
	}
	updateLabelVisibility();

	// ── Env type & label change handlers ──
	envSelect.addEventListener("change", () => {
		updateLabelVisibility();
		sendUpdate();
	});

	labelInput.addEventListener("input", () => {
		sendUpdate();
	});

	function updateLabelVisibility() {
		const noLabel = envSelect.value === "inline-paren" || envSelect.value === "inline-dollar" || envSelect.value === "display-dollar";
		labelInput.disabled = noLabel;
		labelInput.style.opacity = noLabel ? "0.4" : "1";
		if (noLabel) {
			labelInput.value = "";
		}
	}

	// ── Symbol categories ──
	const SYMBOLS = [
		{
			label: "Greek",
			symbols: [
				["\\alpha", "α"], ["\\beta", "β"], ["\\gamma", "γ"], ["\\delta", "δ"],
				["\\epsilon", "ε"], ["\\zeta", "ζ"], ["\\eta", "η"], ["\\theta", "θ"],
				["\\iota", "ι"], ["\\kappa", "κ"], ["\\lambda", "λ"], ["\\mu", "μ"],
				["\\nu", "ν"], ["\\xi", "ξ"], ["\\pi", "π"], ["\\rho", "ρ"],
				["\\sigma", "σ"], ["\\tau", "τ"], ["\\upsilon", "υ"], ["\\phi", "φ"],
				["\\chi", "χ"], ["\\psi", "ψ"], ["\\omega", "ω"],
				["\\Gamma", "Γ"], ["\\Delta", "Δ"], ["\\Theta", "Θ"], ["\\Lambda", "Λ"],
				["\\Xi", "Ξ"], ["\\Pi", "Π"], ["\\Sigma", "Σ"], ["\\Phi", "Φ"],
				["\\Psi", "Ψ"], ["\\Omega", "Ω"],
			],
		},
		{
			label: "Operators",
			symbols: [
				["\\pm", "±"], ["\\mp", "∓"], ["\\times", "×"], ["\\div", "÷"],
				["\\cdot", "·"], ["\\circ", "∘"], ["\\ast", "∗"], ["\\star", "⋆"],
				["\\oplus", "⊕"], ["\\otimes", "⊗"], ["\\odot", "⊙"],
				["\\sum", "∑"], ["\\prod", "∏"], ["\\int", "∫"],
				["\\oint", "∮"], ["\\bigcup", "⋃"], ["\\bigcap", "⋂"],
				["\\partial", "∂"], ["\\nabla", "∇"], ["\\infty", "∞"],
			],
		},
		{
			label: "Relations",
			symbols: [
				["\\leq", "≤"], ["\\geq", "≥"], ["\\neq", "≠"],
				["\\approx", "≈"], ["\\equiv", "≡"], ["\\sim", "∼"],
				["\\simeq", "≃"], ["\\cong", "≅"], ["\\propto", "∝"],
				["\\ll", "≪"], ["\\gg", "≫"],
				["\\subset", "⊂"], ["\\supset", "⊃"],
				["\\subseteq", "⊆"], ["\\supseteq", "⊇"],
				["\\in", "∈"], ["\\notin", "∉"],
				["\\perp", "⊥"], ["\\parallel", "∥"],
			],
		},
		{
			label: "Arrows",
			symbols: [
				["\\leftarrow", "←"], ["\\rightarrow", "→"],
				["\\Leftarrow", "⇐"], ["\\Rightarrow", "⇒"],
				["\\leftrightarrow", "↔"], ["\\Leftrightarrow", "⇔"],
				["\\uparrow", "↑"], ["\\downarrow", "↓"],
				["\\mapsto", "↦"], ["\\longmapsto", "⟼"],
				["\\nearrow", "↗"], ["\\searrow", "↘"],
			],
		},
		{
			label: "Structures",
			symbols: [
				["\\frac{a}{b}", "a/b"],
				["\\sqrt{x}", "√x"],
				["\\sqrt[n]{x}", "ⁿ√x"],
				["\\overline{x}", "x̄"],
				["\\hat{x}", "x̂"],
				["\\vec{x}", "x⃗"],
				["\\dot{x}", "ẋ"],
				["\\ddot{x}", "ẍ"],
				["\\binom{n}{k}", "C(n,k)"],
				["\\langle", "⟨"], ["\\rangle", "⟩"],
				["\\lfloor", "⌊"], ["\\rfloor", "⌋"],
				["\\lceil", "⌈"], ["\\rceil", "⌉"],
			],
		},
		{
			label: "Functions",
			symbols: [
				["\\sin", "sin"], ["\\cos", "cos"], ["\\tan", "tan"],
				["\\ln", "ln"], ["\\log", "log"], ["\\exp", "exp"],
				["\\lim", "lim"], ["\\max", "max"], ["\\min", "min"],
				["\\sup", "sup"], ["\\inf", "inf"],
				["\\det", "det"], ["\\dim", "dim"],
			],
		},
		{
			label: "Matrices",
			symbols: [
				["\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}", "( )"],
				["\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}", "[ ]"],
				["\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}", "| |"],
				["\\begin{cases} a & b \\\\ c & d \\end{cases}", "{ cases"],
			],
		},
	];

	// ── Build toolbar ──
	SYMBOLS.forEach((group) => {
		const wrapper = document.createElement("div");
		wrapper.className = "symbol-group";

		const label = document.createElement("button");
		label.className = "group-toggle";
		label.textContent = group.label;
		label.title = group.label;

		const dropdown = document.createElement("div");
		dropdown.className = "symbol-dropdown hidden";

		group.symbols.forEach(([latex, display]) => {
			const btn = document.createElement("button");
			btn.className = "symbol-btn";
			btn.textContent = display;
			btn.title = latex;
			btn.addEventListener("click", () => insertAtCursor(latex));
			dropdown.appendChild(btn);
		});

		label.addEventListener("click", (e) => {
			e.stopPropagation();
			document.querySelectorAll(".symbol-dropdown").forEach((d) => {
				if (d !== dropdown) d.classList.add("hidden");
			});
			dropdown.classList.toggle("hidden");
		});

		wrapper.appendChild(label);
		wrapper.appendChild(dropdown);
		symbolsToolbar.appendChild(wrapper);
	});

	document.addEventListener("click", () => {
		document.querySelectorAll(".symbol-dropdown").forEach((d) => {
			d.classList.add("hidden");
		});
	});

	// ── Insert helper ──
	function insertAtCursor(text) {
		const start = latexInput.selectionStart;
		const end = latexInput.selectionEnd;
		const before = latexInput.value.substring(0, start);
		const after = latexInput.value.substring(end);
		latexInput.value = before + text + after;
		const newPos = start + text.length;
		latexInput.selectionStart = newPos;
		latexInput.selectionEnd = newPos;
		latexInput.focus();
		onInput();
	}

	// ── Debounced rendering ──
	let debounceTimer = null;

	function onInput() {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			renderPreview();
			sendUpdate();
		}, 150);
	}

	latexInput.addEventListener("input", onInput);

	latexInput.addEventListener("keydown", (e) => {
		if (e.key === "Tab") {
			e.preventDefault();
			const start = latexInput.selectionStart;
			const end = latexInput.selectionEnd;
			latexInput.value =
				latexInput.value.substring(0, start) +
				"\t" +
				latexInput.value.substring(end);
			latexInput.selectionStart = latexInput.selectionEnd = start + 1;
			onInput();
		}
	});

	// ── Render KaTeX preview ──
	function renderPreview() {
		const latex = latexInput.value.trim();
		if (!latex) {
			katexOutput.innerHTML =
				'<span class="placeholder">Preview will appear here...</span>';
			errorOutput.classList.add("hidden");
			return;
		}

		try {
			katexOutput.innerHTML = katex.renderToString(latex, {
				displayMode: true,
				throwOnError: true,
				trust: true,
				strict: false,
			});
			errorOutput.classList.add("hidden");
		} catch (err) {
			try {
				katexOutput.innerHTML = katex.renderToString(latex, {
					displayMode: true,
					throwOnError: false,
					trust: true,
					strict: false,
				});
			} catch (_) {
				katexOutput.innerHTML = "";
			}
			errorOutput.textContent = err.message;
			errorOutput.classList.remove("hidden");
		}
	}

	// ── Send updates to extension ──
	function sendUpdate() {
		vscode.postMessage({
			type: "update",
			content: latexInput.value,
			envType: envSelect.value,
			label: labelInput.value,
		});
	}

	// ── Receive messages from extension ──
	window.addEventListener("message", (event) => {
		const msg = event.data;
		if (msg.type === "setContent") {
			latexInput.value = msg.content;
			if (msg.envType !== undefined) {
				envSelect.value = msg.envType;
				updateLabelVisibility();
			}
			if (msg.label !== undefined) {
				labelInput.value = msg.label;
			}
			renderPreview();
		}
	});

	// ── Initial render ──
	renderPreview();
})();


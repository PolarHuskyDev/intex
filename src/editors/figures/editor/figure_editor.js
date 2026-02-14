// ============================================================
// InTeX Figure Editor — image browser + visual configuration
// ============================================================
(function () {
	"use strict";

	const vscode = acquireVsCodeApi();

	// ══════════════════════════════════════════
	// DOM references
	// ══════════════════════════════════════════

	const wrapperSelect = document.getElementById("wrapperSelect");
	const positionSelect = document.getElementById("positionSelect");
	const labelInput = document.getElementById("labelInput");
	const captionInput = document.getElementById("captionInput");
	const captionPosSelect = document.getElementById("captionPosSelect");
	const pathInput = document.getElementById("pathInput");
	const widthInput = document.getElementById("widthInput");
	const heightInput = document.getElementById("heightInput");
	const scaleInput = document.getElementById("scaleInput");
	const angleInput = document.getElementById("angleInput");
	const searchInput = document.getElementById("searchInput");
	const imageGrid = document.getElementById("imageGrid");
	const refreshBtn = document.getElementById("refreshBtn");
	const emptyMessage = document.getElementById("emptyMessage");

	// ══════════════════════════════════════════
	// State
	// ══════════════════════════════════════════

	let allImages = [];
	let selectedPath = "";

	// Elements that only apply when a figure/figure* wrapper is used
	const wrapperOnlyElements = [
		positionSelect,
		labelInput,
		captionInput,
		captionPosSelect,
	];

	// ══════════════════════════════════════════
	// Initialise from server data
	// ══════════════════════════════════════════

	const initial = window.__INITIAL_FIGURE_DATA__;
	if (initial) {
		applyFigureData(initial);
	}

	// ══════════════════════════════════════════
	// Event listeners
	// ══════════════════════════════════════════

	wrapperSelect.addEventListener("change", () => {
		updateWrapperUI();
		emitUpdate();
	});

	captionPosSelect.addEventListener("change", emitUpdate);

	[
		positionSelect, labelInput, captionInput, pathInput,
		widthInput, heightInput, scaleInput, angleInput,
	].forEach((el) => {
		el.addEventListener("input", debounce(emitUpdate, 150));
		el.addEventListener("change", emitUpdate);
	});

	// When manually editing the path, update carousel selection highlight
	pathInput.addEventListener("input", debounce(() => {
		selectedPath = pathInput.value.trim();
		renderImageGrid();
	}, 150));

	searchInput.addEventListener("input", () => {
		renderImageGrid();
	});

	refreshBtn.addEventListener("click", () => {
		vscode.postMessage({ type: "requestImages" });
	});

	// ══════════════════════════════════════════
	// Apply figure data from extension
	// ══════════════════════════════════════════

	function applyFigureData(data) {
		wrapperSelect.value = data.wrapper || "includegraphics";
		positionSelect.value = data.position || "h";
		labelInput.value = data.label || "";
		captionInput.value = data.caption || "";
		captionPosSelect.value = data.captionPosition || "bottom";
		pathInput.value = data.graphicsPath || "";
		selectedPath = data.graphicsPath || "";

		parseGraphicsOptions(data.graphicsOptions || "");
		updateWrapperUI();
		renderImageGrid();
	}

	// ══════════════════════════════════════════
	// Graphics options parsing
	// ══════════════════════════════════════════

	/**
	 * Parse a combined options string like "width=0.8\textwidth, angle=90"
	 * into the individual input fields.
	 */
	function parseGraphicsOptions(opts) {
		widthInput.value = "";
		heightInput.value = "";
		scaleInput.value = "";
		angleInput.value = "";

		if (!opts) {
			return;
		}

		const parts = opts.split(/\s*,\s*/);
		for (const part of parts) {
			const [key, ...rest] = part.split("=");
			const val = rest.join("=").trim();
			switch (key.trim()) {
				case "width": widthInput.value = val; break;
				case "height": heightInput.value = val; break;
				case "scale": scaleInput.value = val; break;
				case "angle": angleInput.value = val; break;
			}
		}
	}

	/** Build the options string from individual fields. */
	function buildGraphicsOptions() {
		const parts = [];
		const w = widthInput.value.trim();
		const h = heightInput.value.trim();
		const s = scaleInput.value.trim();
		const a = angleInput.value.trim();

		if (w) { parts.push("width=" + w); }
		if (h) { parts.push("height=" + h); }
		if (s) { parts.push("scale=" + s); }
		if (a) { parts.push("angle=" + a); }

		return parts.join(", ");
	}

	// ══════════════════════════════════════════
	// UI state
	// ══════════════════════════════════════════

	/** Enable/disable wrapper-only fields depending on the env selection. */
	function updateWrapperUI() {
		const isStandalone = wrapperSelect.value === "includegraphics";

		wrapperOnlyElements.forEach((el) => {
			el.disabled = isStandalone;
			el.style.opacity = isStandalone ? "0.4" : "1";
		});
	}

	// ══════════════════════════════════════════
	// LaTeX generation
	// ══════════════════════════════════════════

	function buildLatex() {
		const wrapper = wrapperSelect.value;
		const position = positionSelect.value;
		const label = labelInput.value.trim();
		const caption = captionInput.value.trim();
		const captionPos = captionPosSelect.value;
		const path = pathInput.value.trim();
		const opts = buildGraphicsOptions();

		const optStr = opts ? `[${opts}]` : "";
		const includeLine = `\\includegraphics${optStr}{${path}}`;

		if (wrapper === "includegraphics") {
			return includeLine;
		}

		const lines = [];
		lines.push(`\\begin{${wrapper}}[${position}]`);
		lines.push("\t\\centering");

		if (captionPos === "top" && caption) {
			lines.push(`\t\\caption{${caption}}`);
		}

		lines.push(`\t${includeLine}`);

		if (captionPos === "bottom" && caption) {
			lines.push(`\t\\caption{${caption}}`);
		}

		if (label) {
			lines.push(`\t\\label{${label}}`);
		}

		lines.push(`\\end{${wrapper}}`);
		return lines.join("\n");
	}

	// ══════════════════════════════════════════
	// Image grid (scrollable)
	// ══════════════════════════════════════════

	function renderImageGrid() {
		const query = searchInput.value.toLowerCase().trim();
		const filtered = query
			? allImages.filter((img) =>
				img.relativePath.toLowerCase().includes(query),
			)
			: allImages;

		imageGrid.innerHTML = "";

		if (filtered.length === 0) {
			emptyMessage.classList.remove("hidden");
			emptyMessage.textContent =
				allImages.length === 0
					? "No images found in workspace"
					: "No images match your search";
		} else {
			emptyMessage.classList.add("hidden");
		}

		filtered.forEach((img) => {
			const card = document.createElement("div");
			card.className =
				"image-card" +
				(img.relativePath === selectedPath ? " selected" : "");
			card.title = img.relativePath;

			const thumb = document.createElement("div");
			thumb.className = "card-thumb";

			if (img.previewable) {
				const imgEl = document.createElement("img");
				imgEl.src = img.webviewUri;
				imgEl.alt = img.relativePath;
				imgEl.loading = "lazy";
				thumb.appendChild(imgEl);
			} else {
				const ext = img.relativePath.split(".").pop().toUpperCase();
				const placeholder = document.createElement("div");
				placeholder.className = "file-placeholder";
				placeholder.textContent = ext;
				thumb.appendChild(placeholder);
			}

			const label = document.createElement("span");
			label.className = "card-label";
			label.textContent = img.relativePath.split("/").pop();

			card.appendChild(thumb);
			card.appendChild(label);

			card.addEventListener("click", () => {
				selectedPath = img.relativePath;
				pathInput.value = img.relativePath;
				renderImageGrid();
				emitUpdate();
			});

			imageGrid.appendChild(card);
		});

		// Scroll selected card into view
		requestAnimationFrame(() => {
			const selectedCard = imageGrid.querySelector(".image-card.selected");
			if (selectedCard) {
				selectedCard.scrollIntoView({
					behavior: "smooth",
					block: "nearest",
				});
			}
		});
	}

	// ══════════════════════════════════════════
	// Communication with extension
	// ══════════════════════════════════════════

	function emitUpdate() {
		vscode.postMessage({
			type: "update",
			latex: buildLatex(),
		});
	}

	window.addEventListener("message", (event) => {
		const msg = event.data;
		if (msg.type === "setFigure") {
			applyFigureData(msg);
		} else if (msg.type === "imageList") {
			allImages = msg.images || [];
			renderImageGrid();
		}
	});

	// ══════════════════════════════════════════
	// Utilities
	// ══════════════════════════════════════════

	function debounce(fn, ms) {
		let timer;
		return function (...args) {
			clearTimeout(timer);
			timer = setTimeout(() => fn.apply(this, args), ms);
		};
	}

	// ══════════════════════════════════════════
	// Initial setup
	// ══════════════════════════════════════════

	updateWrapperUI();

	// Request the image list from the extension
	vscode.postMessage({ type: "requestImages" });
})();

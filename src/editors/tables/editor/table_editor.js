// ============================================================
// InTeX Table Editor — Excel-like grid for LaTeX tables
// ============================================================
(function () {
	"use strict";

	const vscode = acquireVsCodeApi();

	// ══════════════════════════════════════════
	// DOM references
	// ══════════════════════════════════════════

	const gridTable = document.getElementById("gridTable");
	const latexOutput = document.getElementById("latexOutput");
	const wrapperSelect = document.getElementById("wrapperSelect");
	const positionSelect = document.getElementById("positionSelect");
	const captionInput = document.getElementById("captionInput");
	const labelInput = document.getElementById("labelInput");

	// Alignment buttons
	const btnAlignLeft = document.getElementById("alignLeft");
	const btnAlignCenter = document.getElementById("alignCenter");
	const btnAlignRight = document.getElementById("alignRight");

	// Border buttons
	const btnBorderTop = document.getElementById("borderTop");
	const btnBorderBottom = document.getElementById("borderBottom");
	const btnBorderLeft = document.getElementById("borderLeft");
	const btnBorderRight = document.getElementById("borderRight");
	const btnBorderAll = document.getElementById("borderAll");
	const btnBorderNone = document.getElementById("borderNone");

	// Merge buttons
	const btnMerge = document.getElementById("mergeCells");
	const btnSplit = document.getElementById("splitCells");

	// Structure buttons
	const btnAddRowAbove = document.getElementById("addRowAbove");
	const btnAddRowBelow = document.getElementById("addRowBelow");
	const btnAddColLeft = document.getElementById("addColLeft");
	const btnAddColRight = document.getElementById("addColRight");
	const btnDeleteRow = document.getElementById("deleteRow");
	const btnDeleteCol = document.getElementById("deleteCol");

	// ══════════════════════════════════════════
	// Constants & state
	// ══════════════════════════════════════════

	const MIN_GRID = 10;
	const PADDING = 4;

	/**
	 * @typedef {{ content: string, colspan: number, rowspan: number, hidden: boolean, mergedBy?: {row:number,col:number} }} Cell
	 */

	let state = {
		numRows: MIN_GRID,
		numCols: MIN_GRID,
		/** @type {Cell[][]} */
		cells: [],
		/** @type {string[]} */
		colAligns: [],
		/** @type {boolean[]} */
		colBorders: [],
		/** @type {boolean[][]} */
		rowLines: [],
		wrapper: "tabular",
		position: "h",
		caption: "",
		label: "",
		centering: true,
	};

	let sel = { r1: 0, c1: 0, r2: 0, c2: 0 };
	let editingCell = null; // { row, col }
	let mouseDownOrigin = null; // { row, col } – set on mousedown, cleared on mouseup
	let isDragging = false;     // only true once mouse moves to a different cell

	// ══════════════════════════════════════════
	// State initialization
	// ══════════════════════════════════════════

	function initState(rows, cols) {
		state.numRows = rows;
		state.numCols = cols;
		state.cells = [];
		for (let r = 0; r < rows; r++) {
			state.cells[r] = [];
			for (let c = 0; c < cols; c++) {
				state.cells[r][c] = { content: "", colspan: 1, rowspan: 1, hidden: false };
			}
		}
		state.colAligns = new Array(cols).fill("c");
		state.colBorders = new Array(cols + 1).fill(false);
		state.rowLines = [];
		for (let r = 0; r <= rows; r++) {
			state.rowLines[r] = new Array(cols).fill(false);
		}
	}

	// ══════════════════════════════════════════
	// LaTeX Parser → State
	// ══════════════════════════════════════════

	function loadFromData(data) {
		const { aligns, borders } = parseColSpec(data.colSpec || "c");
		const numCols = aligns.length;

		const { rows, rowLines } = parseTabularContent(data.tabularContent || "", numCols);
		const numRows = rows.length || 1;

		const totalRows = Math.max(numRows + PADDING, MIN_GRID);
		const totalCols = Math.max(numCols + PADDING, MIN_GRID);
		initState(totalRows, totalCols);

		// Fill column alignments and borders
		for (let c = 0; c < numCols; c++) {
			state.colAligns[c] = aligns[c];
		}
		for (let i = 0; i <= numCols && i < state.colBorders.length; i++) {
			state.colBorders[i] = borders[i] || false;
		}

		// Fill cells
		for (let r = 0; r < numRows; r++) {
			for (let c = 0; c < numCols; c++) {
				if (rows[r] && rows[r][c]) {
					state.cells[r][c] = rows[r][c];
				}
			}
		}

		// Fill row lines
		for (let r = 0; r < rowLines.length && r < state.rowLines.length; r++) {
			for (let c = 0; c < numCols && c < state.numCols; c++) {
				state.rowLines[r][c] = rowLines[r] ? (rowLines[r][c] || false) : false;
			}
		}

		// Setup hidden cells for merges
		setupMergedCells();

		// Wrapper options
		state.wrapper = data.wrapper || "tabular";
		state.position = data.position || "h";
		state.caption = data.caption || "";
		state.label = data.label || "";
		state.centering = data.centering !== false;
	}

	function parseColSpec(spec) {
		const aligns = [];
		const borders = [];
		let i = 0;
		let pendingBorder = false;

		while (i < spec.length) {
			if (spec[i] === "|") {
				pendingBorder = true;
				i++;
			} else if ("lcr".includes(spec[i])) {
				borders.push(pendingBorder);
				pendingBorder = false;
				aligns.push(spec[i]);
				i++;
			} else if ("pmb".includes(spec[i])) {
				// p{width}, m{width}, b{width} → treat as left
				borders.push(pendingBorder);
				pendingBorder = false;
				aligns.push("l");
				const braceStart = spec.indexOf("{", i);
				if (braceStart !== -1) {
					const braceEnd = spec.indexOf("}", braceStart);
					i = braceEnd + 1;
				} else {
					i++;
				}
			} else {
				i++;
			}
		}
		borders.push(pendingBorder);

		if (aligns.length === 0) {
			aligns.push("c");
			if (borders.length < 2) {
				borders.push(false);
			}
		}

		return { aligns, borders };
	}

	function parseTabularContent(content, numCols) {
		const rows = [];
		const rowLines = [new Array(numCols).fill(false)]; // line above first row

		content = content.trim();
		if (!content) {
			return { rows, rowLines };
		}

		// Split by \\ (but not inside braces)
		const segments = splitByDoubleBackslash(content);

		for (let i = 0; i < segments.length; i++) {
			let seg = segments[i].trim();
			if (!seg) { continue; }

			// Extract \hline and \cline commands
			const lineCommands = [];
			seg = seg.replace(/\\hline/g, () => {
				lineCommands.push({ type: "hline" });
				return "";
			});
			seg = seg.replace(/\\cline\{(\d+)-(\d+)\}/g, (_, from, to) => {
				lineCommands.push({ type: "cline", from: parseInt(from) - 1, to: parseInt(to) - 1 });
				return "";
			});

			seg = seg.trim();

			if (seg) {
				// Apply line commands to the boundary above this row
				const currentBoundary = rowLines[rowLines.length - 1];
				for (const cmd of lineCommands) {
					if (cmd.type === "hline") {
						for (let c = 0; c < numCols; c++) { currentBoundary[c] = true; }
					} else {
						for (let c = cmd.from; c <= cmd.to && c < numCols; c++) {
							currentBoundary[c] = true;
						}
					}
				}

				// Parse cells in this row
				const cellTexts = splitByCellSeparator(seg);
				const rowCells = [];
				let col = 0;
				for (let ci = 0; ci < cellTexts.length && col < numCols; ci++) {
					const parsed = parseCellContent(cellTexts[ci].trim());
					rowCells[col] = {
						content: parsed.content,
						colspan: parsed.colspan,
						rowspan: parsed.rowspan,
						hidden: false,
					};
					// Mark hidden cells for multicolumn
					for (let dc = 1; dc < parsed.colspan && col + dc < numCols; dc++) {
						rowCells[col + dc] = {
							content: "",
							colspan: 1,
							rowspan: 1,
							hidden: true,
							mergedBy: { row: rows.length, col },
						};
					}
					col += parsed.colspan;
				}
				// Fill remaining columns
				while (col < numCols) {
					rowCells[col] = { content: "", colspan: 1, rowspan: 1, hidden: false };
					col++;
				}

				rows.push(rowCells);
				// Add new row boundary
				rowLines.push(new Array(numCols).fill(false));
			} else {
				// No cell content, just line commands
				const currentBoundary = rowLines[rowLines.length - 1];
				for (const cmd of lineCommands) {
					if (cmd.type === "hline") {
						for (let c = 0; c < numCols; c++) { currentBoundary[c] = true; }
					} else {
						for (let c = cmd.from; c <= cmd.to && c < numCols; c++) {
							currentBoundary[c] = true;
						}
					}
				}
			}
		}

		return { rows, rowLines };
	}

	function splitByDoubleBackslash(text) {
		const parts = [];
		let depth = 0;
		let current = "";
		let i = 0;
		while (i < text.length) {
			if (text[i] === "{") { depth++; current += text[i]; i++; }
			else if (text[i] === "}") { depth--; current += text[i]; i++; }
			else if (text[i] === "\\" && text[i + 1] === "\\" && depth === 0) {
				parts.push(current);
				current = "";
				i += 2;
			} else {
				current += text[i];
				i++;
			}
		}
		if (current.trim()) { parts.push(current); }
		return parts;
	}

	function splitByCellSeparator(text) {
		const cells = [];
		let depth = 0;
		let current = "";
		for (let i = 0; i < text.length; i++) {
			const ch = text[i];
			if (ch === "{") { depth++; }
			else if (ch === "}") { depth--; }
			if (ch === "&" && depth === 0) {
				cells.push(current);
				current = "";
			} else {
				current += ch;
			}
		}
		cells.push(current);
		return cells;
	}

	function parseCellContent(text) {
		const result = { content: text, colspan: 1, rowspan: 1 };

		// Check for \multicolumn{n}{spec}{content}
		const mcMatch = text.match(/^\\multicolumn\{(\d+)\}\{([^}]*)\}\{([\s\S]*)\}$/);
		if (mcMatch) {
			result.colspan = parseInt(mcMatch[1]);
			result.content = mcMatch[3];

			// Check for nested \multirow
			const mrMatch = result.content.match(/^\\multirow\{(\d+)\}\{[^}]*\}\{([\s\S]*)\}$/);
			if (mrMatch) {
				result.rowspan = parseInt(mrMatch[1]);
				result.content = mrMatch[2];
			}
			return result;
		}

		// Check for standalone \multirow{n}{width}{content}
		const mrMatch = text.match(/^\\multirow\{(\d+)\}\{[^}]*\}\{([\s\S]*)\}$/);
		if (mrMatch) {
			result.rowspan = parseInt(mrMatch[1]);
			result.content = mrMatch[2];
			return result;
		}

		return result;
	}

	/**
	 * After loading rows, mark cells covered by multirow spans as hidden.
	 */
	function setupMergedCells() {
		for (let r = 0; r < state.numRows; r++) {
			for (let c = 0; c < state.numCols; c++) {
				const cell = state.cells[r][c];
				if (cell.hidden || !cell) { continue; }
				if (cell.colspan > 1 || cell.rowspan > 1) {
					for (let dr = 0; dr < cell.rowspan; dr++) {
						for (let dc = 0; dc < cell.colspan; dc++) {
							if (dr === 0 && dc === 0) { continue; }
							if (r + dr < state.numRows && c + dc < state.numCols) {
								state.cells[r + dr][c + dc] = {
									content: "",
									colspan: 1,
									rowspan: 1,
									hidden: true,
									mergedBy: { row: r, col: c },
								};
							}
						}
					}
				}
			}
		}
	}

	// ══════════════════════════════════════════
	// LaTeX Generator: State → LaTeX
	// ══════════════════════════════════════════

	function getUsedRange() {
		let minRow = Infinity, maxRow = -1, minCol = Infinity, maxCol = -1;

		for (let r = 0; r < state.numRows; r++) {
			for (let c = 0; c < state.numCols; c++) {
				const cell = state.cells[r][c];
				if (cell.hidden) { continue; }
				if (cell.content.trim()) {
					minRow = Math.min(minRow, r);
					maxRow = Math.max(maxRow, r + cell.rowspan - 1);
					minCol = Math.min(minCol, c);
					maxCol = Math.max(maxCol, c + cell.colspan - 1);
				}
			}
		}

		if (maxRow === -1) {
			return { minRow: 0, maxRow: 0, minCol: 0, maxCol: 0, empty: true };
		}
		return { minRow, maxRow, minCol, maxCol, empty: false };
	}

	function buildHorizontalLine(rowIdx, minCol, maxCol) {
		let allHave = true;
		let anyHave = false;

		for (let c = minCol; c <= maxCol; c++) {
			if (state.rowLines[rowIdx] && state.rowLines[rowIdx][c]) {
				anyHave = true;
			} else {
				allHave = false;
			}
		}

		if (!anyHave) { return null; }
		if (allHave) { return "\\hline"; }

		// Build \cline ranges — promote to \hline if covers all columns
		const clines = [];
		let start = -1;
		for (let c = minCol; c <= maxCol; c++) {
			if (state.rowLines[rowIdx][c]) {
				if (start === -1) { start = c; }
			} else {
				if (start !== -1) {
					clines.push(`\\cline{${start - minCol + 1}-${c - minCol}}`);
					start = -1;
				}
			}
		}
		if (start !== -1) {
			clines.push(`\\cline{${start - minCol + 1}-${maxCol - minCol + 1}}`);
		}

		return clines.join(" ");
	}

	function generateLatex() {
		const { minRow, maxRow, minCol, maxCol, empty } = getUsedRange();

		// Build column spec
		let colSpec = "";
		const effMaxCol = empty ? minCol : maxCol;
		const effMinCol = minCol;
		for (let c = effMinCol; c <= effMaxCol; c++) {
			if (state.colBorders[c]) { colSpec += "|"; }
			colSpec += state.colAligns[c] || "c";
		}
		if (state.colBorders[effMaxCol + 1]) { colSpec += "|"; }

		if (!colSpec) { colSpec = "c"; }

		// Build rows
		const lines = [];

		if (empty) {
			// Output a minimal table
			const hlineAbove = buildHorizontalLine(0, effMinCol, effMaxCol);
			if (hlineAbove) { lines.push(hlineAbove); }
			lines.push(" \\\\");
			const hlineBelow = buildHorizontalLine(1, effMinCol, effMaxCol);
			if (hlineBelow) { lines.push(hlineBelow); }
		} else {
			for (let r = minRow; r <= maxRow; r++) {
				// Horizontal line above this row
				const hline = buildHorizontalLine(r, minCol, maxCol);
				if (hline) { lines.push(hline); }

				// Build cells for this row
				const cellParts = [];
				let c = minCol;
				while (c <= maxCol) {
					const cell = state.cells[r][c];

					if (cell.hidden && cell.mergedBy) {
						const anchor = state.cells[cell.mergedBy.row][cell.mergedBy.col];
						if (cell.mergedBy.row === r) {
							// Same row = multicolumn continuation → skip entirely
							c++;
							continue;
						} else if (c === cell.mergedBy.col) {
							// Same col, different row = multirow continuation
							if (anchor.colspan > 1) {
								// Need multicolumn wrapper with empty content
								let mcSpec = "";
								if (state.colBorders[c]) { mcSpec += "|"; }
								mcSpec += state.colAligns[c] || "c";
								if (state.colBorders[c + anchor.colspan]) { mcSpec += "|"; }
								cellParts.push(`\\multicolumn{${anchor.colspan}}{${mcSpec}}{}`);
								c += anchor.colspan;
							} else {
								cellParts.push("");
								c++;
							}
						} else {
							// Different row and col → covered by both → skip
							c++;
							continue;
						}
					} else if (!cell.hidden) {
						let content = cell.content;
						const needsMultirow = cell.rowspan > 1;
						const needsMulticolumn = cell.colspan > 1;

						if (needsMultirow) {
							content = `\\multirow{${cell.rowspan}}{*}{${content}}`;
						}

						if (needsMulticolumn) {
							let mcSpec = "";
							if (state.colBorders[c]) { mcSpec += "|"; }
							mcSpec += state.colAligns[c] || "c";
							if (state.colBorders[c + cell.colspan]) { mcSpec += "|"; }
							content = `\\multicolumn{${cell.colspan}}{${mcSpec}}{${content}}`;
						}

						cellParts.push(content);
						c += cell.colspan;
					} else {
						cellParts.push("");
						c++;
					}
				}

				lines.push(cellParts.join(" & ") + " \\\\");
			}

			// Horizontal line after last row
			const hlineAfter = buildHorizontalLine(maxRow + 1, minCol, maxCol);
			if (hlineAfter) { lines.push(hlineAfter); }
		}

		const tabularBody = lines.join("\n");
		const tabular = `\\begin{tabular}{${colSpec}}\n${tabularBody}\n\\end{tabular}`;

		if (state.wrapper !== "tabular") {
			const parts = [`\\begin{${state.wrapper}}[${state.position}]`];
			if (state.centering) { parts.push("\\centering"); }
			parts.push(tabular);
			if (state.caption !== undefined) { parts.push(`\\caption{${state.caption}}`); }
			if (state.label !== undefined) { parts.push(`\\label{${state.label}}`); }
			parts.push(`\\end{${state.wrapper}}`);
			return parts.join("\n");
		}

		return tabular;
	}

	// ══════════════════════════════════════════
	// Grid Renderer
	// ══════════════════════════════════════════

	function colLetter(c) {
		let s = "";
		let n = c;
		do {
			s = String.fromCharCode(65 + (n % 26)) + s;
			n = Math.floor(n / 26) - 1;
		} while (n >= 0);
		return s;
	}

	function getNormalizedSel() {
		return {
			r1: Math.min(sel.r1, sel.r2),
			c1: Math.min(sel.c1, sel.c2),
			r2: Math.max(sel.r1, sel.r2),
			c2: Math.max(sel.c1, sel.c2),
		};
	}

	function isCellInSelection(r, c, cs, rs) {
		const s = getNormalizedSel();
		const cellR2 = r + (rs || 1) - 1;
		const cellC2 = c + (cs || 1) - 1;
		return !(cellR2 < s.r1 || r > s.r2 || cellC2 < s.c1 || c > s.c2);
	}

	function renderGrid() {
		// Save editing state
		if (editingCell) {
			commitEdit();
		}

		gridTable.innerHTML = "";

		// Header row
		const thead = document.createElement("thead");
		const headerRow = document.createElement("tr");

		// Corner
		const corner = document.createElement("th");
		corner.className = "corner";
		corner.addEventListener("click", () => {
			sel = { r1: 0, c1: 0, r2: state.numRows - 1, c2: state.numCols - 1 };
			renderGrid();
		});
		headerRow.appendChild(corner);

		// Column headers
		for (let c = 0; c < state.numCols; c++) {
			const th = document.createElement("th");
			th.className = "col-header";
			const s = getNormalizedSel();
			if (c >= s.c1 && c <= s.c2) { th.classList.add("selected"); }

			const align = (state.colAligns[c] || "c").toUpperCase();
			th.textContent = `${colLetter(c)} (${align})`;
			th.addEventListener("click", (e) => {
				if (e.shiftKey) {
					sel.c2 = c;
					sel.r2 = state.numRows - 1;
				} else {
					sel = { r1: 0, c1: c, r2: state.numRows - 1, c2: c };
				}
				renderGrid();
				updateAlignButtons();
			});
			headerRow.appendChild(th);
		}
		thead.appendChild(headerRow);
		gridTable.appendChild(thead);

		// Body
		const tbody = document.createElement("tbody");

		for (let r = 0; r < state.numRows; r++) {
			const tr = document.createElement("tr");

			// Row header
			const rh = document.createElement("td");
			rh.className = "row-header";
			const s = getNormalizedSel();
			if (r >= s.r1 && r <= s.r2) { rh.classList.add("selected"); }
			rh.textContent = String(r + 1);
			rh.addEventListener("click", (e) => {
				if (e.shiftKey) {
					sel.r2 = r;
					sel.c2 = state.numCols - 1;
				} else {
					sel = { r1: r, c1: 0, r2: r, c2: state.numCols - 1 };
				}
				renderGrid();
			});
			tr.appendChild(rh);

			for (let c = 0; c < state.numCols; c++) {
				const cell = state.cells[r][c];
				if (cell.hidden) { continue; }

				const td = document.createElement("td");
				td.className = "cell";
				td.dataset.row = r;
				td.dataset.col = c;

				if (cell.colspan > 1) { td.colSpan = cell.colspan; }
				if (cell.rowspan > 1) { td.rowSpan = cell.rowspan; }

				// Selection
				if (isCellInSelection(r, c, cell.colspan, cell.rowspan)) {
					td.classList.add("selected");
				}
				if (r === sel.r1 && c === sel.c1) {
					td.classList.add("sel-primary");
				}

				// Merge indicator
				if (cell.colspan > 1 || cell.rowspan > 1) {
					td.classList.add("merged");
				}

				// Border classes
				if (state.colBorders[c]) { td.classList.add("border-l"); }
				if (state.colBorders[c + cell.colspan]) { td.classList.add("border-r"); }

				// Top border: all columns in span must have line
				let topAll = true;
				for (let cc = c; cc < c + cell.colspan; cc++) {
					if (!state.rowLines[r] || !state.rowLines[r][cc]) { topAll = false; break; }
				}
				if (topAll && state.rowLines[r]) { td.classList.add("border-t"); }

				// Bottom border
				const bottomRow = r + cell.rowspan;
				let bottomAll = true;
				for (let cc = c; cc < c + cell.colspan; cc++) {
					if (!state.rowLines[bottomRow] || !state.rowLines[bottomRow][cc]) { bottomAll = false; break; }
				}
				if (bottomAll && state.rowLines[bottomRow]) { td.classList.add("border-b"); }

				// Content
				td.textContent = cell.content;

				// Events
				td.addEventListener("mousedown", (e) => handleCellMouseDown(e, r, c));
				td.addEventListener("mouseover", (e) => handleCellMouseOver(e, r, c));
				td.addEventListener("dblclick", () => startEditing(r, c));

				tr.appendChild(td);
			}

			tbody.appendChild(tr);
		}

		gridTable.appendChild(tbody);
		updateAlignButtons();
	}

	// ══════════════════════════════════════════
	// Cell selection
	// ══════════════════════════════════════════

	function handleCellMouseDown(e, r, c) {
		// Don't prevent default — we need normal focus/click behavior for toolbar
		if (editingCell && (editingCell.row !== r || editingCell.col !== c)) {
			commitEdit();
		}
		if (e.shiftKey) {
			sel.r2 = r;
			sel.c2 = c;
		} else {
			sel = { r1: r, c1: c, r2: r, c2: c };
		}
		mouseDownOrigin = { row: r, col: c };
		isDragging = false; // not dragging yet — only on move to a different cell
		updateGridSelection();
		updateAlignButtons();
	}

	function handleCellMouseOver(e, r, c) {
		if (!mouseDownOrigin) { return; }
		// Only activate drag mode once the mouse reaches a different cell
		if (r === mouseDownOrigin.row && c === mouseDownOrigin.col) { return; }
		isDragging = true;
		sel.r2 = r;
		sel.c2 = c;
		updateGridSelection();
	}

	document.addEventListener("mouseup", () => {
		mouseDownOrigin = null;
		isDragging = false;
	});

	/**
	 * Lightweight selection update — toggles CSS classes without rebuilding the DOM.
	 */
	function updateGridSelection() {
		const s = getNormalizedSel();

		// Update column headers
		gridTable.querySelectorAll(".col-header").forEach((th) => {
			const c = parseInt(th.cellIndex) - 1; // account for corner cell
			th.classList.toggle("selected", c >= s.c1 && c <= s.c2);
		});

		// Update row headers
		gridTable.querySelectorAll(".row-header").forEach((rh) => {
			const r = parseInt(rh.textContent) - 1;
			rh.classList.toggle("selected", r >= s.r1 && r <= s.r2);
		});

		// Update data cells
		gridTable.querySelectorAll(".cell").forEach((td) => {
			const r = parseInt(td.dataset.row);
			const c = parseInt(td.dataset.col);
			const cell = state.cells[r][c];
			td.classList.toggle("selected", isCellInSelection(r, c, cell.colspan, cell.rowspan));
			td.classList.toggle("sel-primary", r === sel.r1 && c === sel.c1);
		});
	}

	// ══════════════════════════════════════════
	// Cell editing
	// ══════════════════════════════════════════

	function startEditing(r, c) {
		if (editingCell) { commitEdit(); }
		const cell = state.cells[r][c];
		if (cell.hidden) { return; }

		editingCell = { row: r, col: c };

		const td = gridTable.querySelector(`td[data-row="${r}"][data-col="${c}"]`);
		if (!td) { return; }

		td.classList.add("editing");
		td.contentEditable = "true";
		td.focus();

		// Select all text
		const range = document.createRange();
		range.selectNodeContents(td);
		const selObj = window.getSelection();
		selObj.removeAllRanges();
		selObj.addRange(range);
	}

	function commitEdit() {
		if (!editingCell) { return; }
		const { row, col } = editingCell;

		const td = gridTable.querySelector(`td[data-row="${row}"][data-col="${col}"]`);
		if (td) {
			state.cells[row][col].content = td.textContent || "";
			td.contentEditable = "false";
			td.classList.remove("editing");
		}
		editingCell = null;
		onStateChange();
	}

	// ══════════════════════════════════════════
	// Keyboard handling
	// ══════════════════════════════════════════

	document.addEventListener("keydown", (e) => {
		// If we're editing a cell, handle edit-mode keys
		if (editingCell) {
			if (e.key === "Escape") {
				// Cancel edit (revert)
				const { row, col } = editingCell;
				const td = gridTable.querySelector(`td[data-row="${row}"][data-col="${col}"]`);
				if (td) {
					td.textContent = state.cells[row][col].content;
					td.contentEditable = "false";
					td.classList.remove("editing");
				}
				editingCell = null;
				e.preventDefault();
				return;
			}
			if (e.key === "Enter" && !e.shiftKey) {
				commitEdit();
				moveSelection(1, 0);
				e.preventDefault();
				return;
			}
			if (e.key === "Tab") {
				commitEdit();
				moveSelection(0, e.shiftKey ? -1 : 1);
				e.preventDefault();
				return;
			}
			return; // Let other keys go through for editing
		}

		// Navigation mode
		if (e.key === "ArrowUp") { moveSelection(-1, 0); e.preventDefault(); }
		else if (e.key === "ArrowDown") { moveSelection(1, 0); e.preventDefault(); }
		else if (e.key === "ArrowLeft") { moveSelection(0, -1); e.preventDefault(); }
		else if (e.key === "ArrowRight") { moveSelection(0, 1); e.preventDefault(); }
		else if (e.key === "Tab") { moveSelection(0, e.shiftKey ? -1 : 1); e.preventDefault(); }
		else if (e.key === "Enter") { startEditing(sel.r1, sel.c1); e.preventDefault(); }
		else if (e.key === "Delete" || e.key === "Backspace") {
			clearSelection();
			e.preventDefault();
		}
		else if (e.key === "F2") {
			startEditing(sel.r1, sel.c1);
			e.preventDefault();
		}
		else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
			// Start typing → enter edit mode and replace content
			state.cells[sel.r1][sel.c1].content = "";
			renderGrid();
			startEditing(sel.r1, sel.c1);
			// The typed character will be handled by contenteditable
		}
	});

	function moveSelection(dr, dc) {
		let r = sel.r1 + dr;
		let c = sel.c1 + dc;

		// Wrap and clamp
		if (c >= state.numCols) { c = 0; r++; }
		if (c < 0) { c = state.numCols - 1; r--; }
		r = Math.max(0, Math.min(state.numRows - 1, r));
		c = Math.max(0, Math.min(state.numCols - 1, c));

		// Skip hidden cells
		const cell = state.cells[r][c];
		if (cell.hidden && cell.mergedBy) {
			r = cell.mergedBy.row;
			c = cell.mergedBy.col;
		}

		sel = { r1: r, c1: c, r2: r, c2: c };
		renderGrid();
	}

	function clearSelection() {
		const s = getNormalizedSel();
		for (let r = s.r1; r <= s.r2; r++) {
			for (let c = s.c1; c <= s.c2; c++) {
				if (!state.cells[r][c].hidden) {
					state.cells[r][c].content = "";
				}
			}
		}
		onStateChange();
		renderGrid();
	}

	// ══════════════════════════════════════════
	// Toolbar: Alignment
	// ══════════════════════════════════════════

	function setAlignment(align) {
		const s = getNormalizedSel();
		for (let c = s.c1; c <= s.c2; c++) {
			state.colAligns[c] = align;
		}
		onStateChange();
		renderGrid();
	}

	function updateAlignButtons() {
		const align = state.colAligns[sel.c1] || "c";
		btnAlignLeft.classList.toggle("active", align === "l");
		btnAlignCenter.classList.toggle("active", align === "c");
		btnAlignRight.classList.toggle("active", align === "r");
	}

	btnAlignLeft.addEventListener("click", () => setAlignment("l"));
	btnAlignCenter.addEventListener("click", () => setAlignment("c"));
	btnAlignRight.addEventListener("click", () => setAlignment("r"));

	// ══════════════════════════════════════════
	// Toolbar: Borders
	// ══════════════════════════════════════════

	btnBorderTop.addEventListener("click", () => {
		const s = getNormalizedSel();
		const rowIdx = s.r1;
		// Toggle: if all selected cols have the line, remove; else add
		let allSet = true;
		for (let c = s.c1; c <= s.c2; c++) {
			if (!state.rowLines[rowIdx][c]) { allSet = false; break; }
		}
		for (let c = s.c1; c <= s.c2; c++) {
			state.rowLines[rowIdx][c] = !allSet;
		}
		onStateChange();
		renderGrid();
	});

	btnBorderBottom.addEventListener("click", () => {
		const s = getNormalizedSel();
		const rowIdx = s.r2 + 1;
		if (rowIdx >= state.rowLines.length) { return; }
		let allSet = true;
		for (let c = s.c1; c <= s.c2; c++) {
			if (!state.rowLines[rowIdx][c]) { allSet = false; break; }
		}
		for (let c = s.c1; c <= s.c2; c++) {
			state.rowLines[rowIdx][c] = !allSet;
		}
		onStateChange();
		renderGrid();
	});

	btnBorderLeft.addEventListener("click", () => {
		const s = getNormalizedSel();
		state.colBorders[s.c1] = !state.colBorders[s.c1];
		onStateChange();
		renderGrid();
	});

	btnBorderRight.addEventListener("click", () => {
		const s = getNormalizedSel();
		state.colBorders[s.c2 + 1] = !state.colBorders[s.c2 + 1];
		onStateChange();
		renderGrid();
	});

	btnBorderAll.addEventListener("click", () => {
		const s = getNormalizedSel();
		// Set vertical borders around and between selected columns
		for (let c = s.c1; c <= s.c2 + 1; c++) {
			state.colBorders[c] = true;
		}
		// Set horizontal borders around and between selected rows
		for (let r = s.r1; r <= s.r2 + 1; r++) {
			if (state.rowLines[r]) {
				for (let c = s.c1; c <= s.c2; c++) {
					state.rowLines[r][c] = true;
				}
			}
		}
		onStateChange();
		renderGrid();
	});

	btnBorderNone.addEventListener("click", () => {
		const s = getNormalizedSel();
		for (let c = s.c1; c <= s.c2 + 1; c++) {
			state.colBorders[c] = false;
		}
		for (let r = s.r1; r <= s.r2 + 1; r++) {
			if (state.rowLines[r]) {
				for (let c = s.c1; c <= s.c2; c++) {
					state.rowLines[r][c] = false;
				}
			}
		}
		onStateChange();
		renderGrid();
	});

	// ══════════════════════════════════════════
	// Toolbar: Merge / Split
	// ══════════════════════════════════════════

	btnMerge.addEventListener("click", () => {
		const s = getNormalizedSel();
		const spanRows = s.r2 - s.r1 + 1;
		const spanCols = s.c2 - s.c1 + 1;

		if (spanRows === 1 && spanCols === 1) { return; } // Nothing to merge

		// Check no existing merge overlaps
		for (let r = s.r1; r <= s.r2; r++) {
			for (let c = s.c1; c <= s.c2; c++) {
				const cell = state.cells[r][c];
				if (cell.hidden && cell.mergedBy) {
					const anchor = cell.mergedBy;
					if (anchor.row < s.r1 || anchor.col < s.c1) {
						return; // Overlaps with external merge, abort
					}
				}
				if (!cell.hidden && (cell.colspan > 1 || cell.rowspan > 1)) {
					if (r !== s.r1 || c !== s.c1) {
						// Another merge anchor inside selection → dissolve it first
						cell.colspan = 1;
						cell.rowspan = 1;
					}
				}
			}
		}

		// Collect content from anchor (top-left) cell
		const anchorCell = state.cells[s.r1][s.c1];
		// If anchor has no content, try to find content in the selection
		if (!anchorCell.content.trim()) {
			for (let r = s.r1; r <= s.r2; r++) {
				for (let c = s.c1; c <= s.c2; c++) {
					if (state.cells[r][c].content.trim()) {
						anchorCell.content = state.cells[r][c].content;
						break;
					}
				}
				if (anchorCell.content.trim()) { break; }
			}
		}

		// Set the merge
		anchorCell.colspan = spanCols;
		anchorCell.rowspan = spanRows;
		anchorCell.hidden = false;
		delete anchorCell.mergedBy;

		// Mark other cells as hidden
		for (let r = s.r1; r <= s.r2; r++) {
			for (let c = s.c1; c <= s.c2; c++) {
				if (r === s.r1 && c === s.c1) { continue; }
				state.cells[r][c] = {
					content: "",
					colspan: 1,
					rowspan: 1,
					hidden: true,
					mergedBy: { row: s.r1, col: s.c1 },
				};
			}
		}

		onStateChange();
		renderGrid();
	});

	btnSplit.addEventListener("click", () => {
		const { r1, c1 } = sel;
		const cell = state.cells[r1][c1];

		if (cell.colspan <= 1 && cell.rowspan <= 1) { return; }

		const spanRows = cell.rowspan;
		const spanCols = cell.colspan;

		cell.colspan = 1;
		cell.rowspan = 1;

		// Unhide cells
		for (let r = r1; r < r1 + spanRows; r++) {
			for (let c = c1; c < c1 + spanCols; c++) {
				if (r === r1 && c === c1) { continue; }
				if (r < state.numRows && c < state.numCols) {
					state.cells[r][c] = {
						content: "",
						colspan: 1,
						rowspan: 1,
						hidden: false,
					};
				}
			}
		}

		onStateChange();
		renderGrid();
	});

	// ══════════════════════════════════════════
	// Toolbar: Structure (add/remove rows/cols)
	// ══════════════════════════════════════════

	function insertRow(afterRow) {
		const newRow = [];
		for (let c = 0; c < state.numCols; c++) {
			newRow.push({ content: "", colspan: 1, rowspan: 1, hidden: false });
		}
		state.cells.splice(afterRow + 1, 0, newRow);
		state.numRows++;

		// Insert row line entry
		state.rowLines.splice(afterRow + 1, 0, new Array(state.numCols).fill(false));

		// Adjust merges that span across the insertion point
		for (let r = 0; r < state.numRows; r++) {
			for (let c = 0; c < state.numCols; c++) {
				const cell = state.cells[r][c];
				if (!cell.hidden && cell.rowspan > 1 && r <= afterRow && r + cell.rowspan - 1 > afterRow) {
					// This merge spans past the insertion point → increase rowspan
					cell.rowspan++;
					// Mark the new row's cells as hidden
					for (let dc = 0; dc < cell.colspan; dc++) {
						state.cells[afterRow + 1][c + dc] = {
							content: "",
							colspan: 1,
							rowspan: 1,
							hidden: true,
							mergedBy: { row: r, col: c },
						};
					}
				}
			}
		}

		// Fix mergedBy references for rows after insertion
		for (let r = afterRow + 2; r < state.numRows; r++) {
			for (let c = 0; c < state.numCols; c++) {
				const cell = state.cells[r][c];
				if (cell.hidden && cell.mergedBy && cell.mergedBy.row > afterRow) {
					// Don't shift — the anchor was also shifted by the splice
				}
			}
		}

		onStateChange();
		renderGrid();
	}

	function insertCol(afterCol) {
		for (let r = 0; r < state.numRows; r++) {
			state.cells[r].splice(afterCol + 1, 0, { content: "", colspan: 1, rowspan: 1, hidden: false });
		}
		state.numCols++;

		state.colAligns.splice(afterCol + 1, 0, "c");
		state.colBorders.splice(afterCol + 1, 0, false);

		for (let r = 0; r <= state.numRows; r++) {
			if (state.rowLines[r]) {
				state.rowLines[r].splice(afterCol + 1, 0, false);
			}
		}

		// Adjust merges spanning past insertion
		for (let r = 0; r < state.numRows; r++) {
			for (let c = 0; c < state.numCols; c++) {
				const cell = state.cells[r][c];
				if (!cell.hidden && cell.colspan > 1 && c <= afterCol && c + cell.colspan - 1 > afterCol) {
					cell.colspan++;
					for (let dr = 0; dr < cell.rowspan; dr++) {
						state.cells[r + dr][afterCol + 1] = {
							content: "",
							colspan: 1,
							rowspan: 1,
							hidden: true,
							mergedBy: { row: r, col: c },
						};
					}
				}
			}
		}

		onStateChange();
		renderGrid();
	}

	function deleteRow(rowIdx) {
		if (state.numRows <= 1) { return; }

		// Check for merge anchors in this row
		for (let c = 0; c < state.numCols; c++) {
			const cell = state.cells[rowIdx][c];
			if (!cell.hidden && cell.rowspan > 1) {
				// Move anchor to next row
				cell.rowspan--;
				if (cell.rowspan > 0) {
					const nextRow = rowIdx + 1;
					if (nextRow < state.numRows) {
						state.cells[nextRow][c] = {
							content: cell.content,
							colspan: cell.colspan,
							rowspan: cell.rowspan,
							hidden: false,
						};
						// Update mergedBy references
						for (let dr = 1; dr < cell.rowspan; dr++) {
							for (let dc = 0; dc < cell.colspan; dc++) {
								if (state.cells[nextRow + dr] && state.cells[nextRow + dr][c + dc]) {
									state.cells[nextRow + dr][c + dc].mergedBy = { row: nextRow, col: c };
								}
							}
						}
					}
				}
			}
			// Shrink merges that span this row from above
			if (cell.hidden && cell.mergedBy) {
				const anchor = state.cells[cell.mergedBy.row]?.[cell.mergedBy.col];
				if (anchor && !anchor.hidden && anchor.rowspan > 1 && cell.mergedBy.row < rowIdx) {
					anchor.rowspan--;
				}
			}
		}

		state.cells.splice(rowIdx, 1);
		state.rowLines.splice(rowIdx, 1);
		state.numRows--;

		onStateChange();
		renderGrid();
	}

	function deleteCol(colIdx) {
		if (state.numCols <= 1) { return; }

		for (let r = 0; r < state.numRows; r++) {
			const cell = state.cells[r][colIdx];
			if (!cell.hidden && cell.colspan > 1) {
				cell.colspan--;
				if (cell.colspan > 0 && colIdx + 1 < state.numCols) {
					state.cells[r][colIdx + 1] = {
						content: cell.content,
						colspan: cell.colspan,
						rowspan: cell.rowspan,
						hidden: false,
					};
				}
			}
			if (cell.hidden && cell.mergedBy) {
				const anchor = state.cells[cell.mergedBy.row]?.[cell.mergedBy.col];
				if (anchor && !anchor.hidden && anchor.colspan > 1 && cell.mergedBy.col < colIdx) {
					anchor.colspan--;
				}
			}
			state.cells[r].splice(colIdx, 1);
		}

		state.colAligns.splice(colIdx, 1);
		state.colBorders.splice(colIdx, 1);
		state.numCols--;

		for (let r = 0; r <= state.numRows; r++) {
			if (state.rowLines[r]) {
				state.rowLines[r].splice(colIdx, 1);
			}
		}

		onStateChange();
		renderGrid();
	}

	btnAddRowAbove.addEventListener("click", () => insertRow(getNormalizedSel().r1 - 1));
	btnAddRowBelow.addEventListener("click", () => insertRow(getNormalizedSel().r2));
	btnAddColLeft.addEventListener("click", () => insertCol(getNormalizedSel().c1 - 1));
	btnAddColRight.addEventListener("click", () => insertCol(getNormalizedSel().c2));
	btnDeleteRow.addEventListener("click", () => deleteRow(getNormalizedSel().r1));
	btnDeleteCol.addEventListener("click", () => deleteCol(getNormalizedSel().c1));

	// ══════════════════════════════════════════
	// Toolbar: Table options
	// ══════════════════════════════════════════

	function updateWrapperUI() {
		const isWrapped = state.wrapper !== "tabular";
		positionSelect.disabled = !isWrapped;
		captionInput.disabled = !isWrapped;
		labelInput.disabled = !isWrapped;
	}

	wrapperSelect.addEventListener("change", () => {
		state.wrapper = wrapperSelect.value;
		updateWrapperUI();
		onStateChange();
	});

	positionSelect.addEventListener("change", () => {
		state.position = positionSelect.value;
		onStateChange();
	});

	captionInput.addEventListener("input", () => {
		state.caption = captionInput.value;
		onStateChange();
	});

	labelInput.addEventListener("input", () => {
		state.label = labelInput.value;
		onStateChange();
	});

	function updateOptionControls() {
		wrapperSelect.value = state.wrapper;
		positionSelect.value = state.position || "h";
		captionInput.value = state.caption || "";
		labelInput.value = state.label || "";
		updateWrapperUI();
	}

	// ══════════════════════════════════════════
	// State change handling
	// ══════════════════════════════════════════

	let debounceTimer = null;

	function onStateChange() {
		updateLatexPreview();
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			sendUpdate();
		}, 200);
	}

	function updateLatexPreview() {
		latexOutput.textContent = generateLatex();
	}

	// ══════════════════════════════════════════
	// Communication with extension
	// ══════════════════════════════════════════

	function sendUpdate() {
		vscode.postMessage({
			type: "update",
			latex: generateLatex(),
		});
	}

	window.addEventListener("message", (event) => {
		const msg = event.data;
		if (msg.type === "setTable") {
			loadFromData(msg);
			updateOptionControls();
			sel = { r1: 0, c1: 0, r2: 0, c2: 0 };
			editingCell = null;
			renderGrid();
			updateLatexPreview();
		}
	});

	// ══════════════════════════════════════════
	// Initialization
	// ══════════════════════════════════════════

	function init() {
		initState(MIN_GRID, MIN_GRID);

		if (window.__INITIAL_TABLE_DATA__) {
			loadFromData(window.__INITIAL_TABLE_DATA__);
		}

		updateOptionControls();
		renderGrid();
		updateLatexPreview();
	}

	init();
})();

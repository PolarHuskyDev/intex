// ============================================================
// InTeX BibTeX Editor — searchable CRUD UI for .bib entries
// ============================================================
(function () {
	"use strict";

	const vscode = acquireVsCodeApi();

	// ══════════════════════════════════════════
	// Standard BibTeX entry types
	// ══════════════════════════════════════════

	const ENTRY_TYPES = [
		"article", "book", "booklet", "conference", "inbook",
		"incollection", "inproceedings", "manual", "mastersthesis",
		"misc", "phdthesis", "proceedings", "techreport", "unpublished",
	];

	/** Common fields shown by default when creating certain entry types. */
	const DEFAULT_FIELDS = {
		article:       ["author", "title", "journal", "year", "volume", "number", "pages", "doi"],
		book:          ["author", "title", "publisher", "year", "isbn"],
		inproceedings: ["author", "title", "booktitle", "year", "pages", "doi"],
		incollection:  ["author", "title", "booktitle", "publisher", "year", "pages"],
		phdthesis:     ["author", "title", "school", "year"],
		mastersthesis: ["author", "title", "school", "year"],
		techreport:    ["author", "title", "institution", "year", "number"],
		misc:          ["author", "title", "howpublished", "year", "note"],
		_default:      ["author", "title", "year"],
	};

	// ══════════════════════════════════════════
	// DOM references
	// ══════════════════════════════════════════

	const searchInput       = document.getElementById("searchInput");
	const entryListEl       = document.getElementById("entryList");
	const entryCountEl      = document.getElementById("entryCount");
	const addBtn            = document.getElementById("addBtn");
	const fileLabelEl       = document.getElementById("fileLabel");

	const emptyState        = document.getElementById("emptyState");
	const entryForm         = document.getElementById("entryForm");
	const entryTypeSelect   = document.getElementById("entryTypeSelect");
	const citeKeyInput      = document.getElementById("citeKeyInput");
	const fieldsContainer   = document.getElementById("fieldsContainer");
	const saveBtn           = document.getElementById("saveBtn");
	const deleteBtn         = document.getElementById("deleteBtn");
	const newFieldName      = document.getElementById("newFieldName");
	const addFieldBtn       = document.getElementById("addFieldBtn");

	// ══════════════════════════════════════════
	// State
	// ══════════════════════════════════════════

	let entries = [];           // Array of { entryType, citeKey, fields }
	let selectedKey = null;     // citeKey of currently selected entry
	let isCreating = false;     // true when the form is in "create" mode

	// ══════════════════════════════════════════
	// Initialise entry type <select>
	// ══════════════════════════════════════════

	ENTRY_TYPES.forEach((t) => {
		const opt = document.createElement("option");
		opt.value = t;
		opt.textContent = t;
		entryTypeSelect.appendChild(opt);
	});

	// ══════════════════════════════════════════
	// Event listeners
	// ══════════════════════════════════════════

	searchInput.addEventListener("input", renderEntryList);

	addBtn.addEventListener("click", () => {
		startCreate();
	});

	saveBtn.addEventListener("click", () => {
		saveCurrentEntry();
	});

	deleteBtn.addEventListener("click", () => {
		deleteCurrentEntry();
	});

	addFieldBtn.addEventListener("click", () => {
		addField();
	});

	newFieldName.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			addField();
		}
	});

	// ══════════════════════════════════════════
	// Messages from extension
	// ══════════════════════════════════════════

	window.addEventListener("message", (event) => {
		const msg = event.data;
		if (msg.type === "setEntries") {
			entries = msg.entries || [];
			if (msg.fileName) {
				fileLabelEl.textContent = msg.fileName;
			}
			renderEntryList();

			// Re-select if still exists
			if (selectedKey && !isCreating) {
				const still = entries.find((e) => e.citeKey === selectedKey);
				if (still) {
					showEntry(still);
				} else {
					clearDetail();
				}
			}
		}
	});

	// Tell the backend we're ready
	vscode.postMessage({ type: "ready" });

	// ══════════════════════════════════════════
	// Entry list rendering
	// ══════════════════════════════════════════

	function renderEntryList() {
		const query = searchInput.value.toLowerCase().trim();
		const filtered = query
			? entries.filter((e) => {
				const hay = [
					e.citeKey,
					e.fields.title || "",
					e.fields.author || "",
					e.entryType,
				].join(" ").toLowerCase();
				return hay.includes(query);
			})
			: entries;

		entryListEl.innerHTML = "";

		filtered.forEach((entry) => {
			const item = document.createElement("div");
			item.className = "entry-item" + (entry.citeKey === selectedKey ? " selected" : "");

			const keyRow = document.createElement("div");
			keyRow.className = "entry-key";

			const badge = document.createElement("span");
			badge.className = "entry-type-badge";
			badge.textContent = entry.entryType;

			const keyText = document.createTextNode(entry.citeKey);

			keyRow.appendChild(badge);
			keyRow.appendChild(keyText);
			item.appendChild(keyRow);

			if (entry.fields.title) {
				const titleEl = document.createElement("div");
				titleEl.className = "entry-title";
				titleEl.textContent = entry.fields.title;
				item.appendChild(titleEl);
			}

			const metaParts = [];
			if (entry.fields.author) {
				metaParts.push(entry.fields.author);
			}
			if (entry.fields.year) {
				metaParts.push(entry.fields.year);
			}
			if (metaParts.length) {
				const meta = document.createElement("div");
				meta.className = "entry-meta";
				meta.textContent = metaParts.join(" · ");
				item.appendChild(meta);
			}

			item.addEventListener("click", () => {
				isCreating = false;
				selectedKey = entry.citeKey;
				showEntry(entry);
				renderEntryList();
			});

			entryListEl.appendChild(item);
		});

		const total = entries.length;
		const shown = filtered.length;
		entryCountEl.textContent = query
			? `${shown} of ${total} entries`
			: `${total} entries`;
	}

	// ══════════════════════════════════════════
	// Show an entry in the detail form
	// ══════════════════════════════════════════

	function showEntry(entry) {
		emptyState.style.display = "none";
		entryForm.classList.remove("hidden");

		entryTypeSelect.value = entry.entryType;
		citeKeyInput.value = entry.citeKey;
		citeKeyInput.dataset.originalKey = entry.citeKey;

		deleteBtn.style.display = "";

		renderFields(entry.fields);
	}

	function clearDetail() {
		selectedKey = null;
		isCreating = false;
		emptyState.style.display = "";
		entryForm.classList.add("hidden");
	}

	// ══════════════════════════════════════════
	// Field rendering
	// ══════════════════════════════════════════

	function renderFields(fields) {
		fieldsContainer.innerHTML = "";
		const keys = Object.keys(fields);

		keys.forEach((key) => {
			addFieldRow(key, fields[key]);
		});
	}

	function addFieldRow(name, value) {
		const row = document.createElement("div");
		row.className = "field-row";

		const nameEl = document.createElement("input");
		nameEl.className = "field-name";
		nameEl.type = "text";
		nameEl.value = name;
		nameEl.readOnly = true;
		nameEl.tabIndex = -1;

		const valueEl = document.createElement("textarea");
		valueEl.className = "field-value";
		valueEl.value = value || "";
		valueEl.placeholder = name + "…";
		valueEl.rows = 1;
		valueEl.dataset.fieldName = name;

		// Auto-resize
		valueEl.addEventListener("input", () => {
			autoResize(valueEl);
		});
		requestAnimationFrame(() => autoResize(valueEl));

		const removeBtn = document.createElement("button");
		removeBtn.className = "field-remove-btn";
		removeBtn.textContent = "×";
		removeBtn.title = "Remove field";
		removeBtn.addEventListener("click", () => {
			row.remove();
		});

		row.appendChild(nameEl);
		row.appendChild(valueEl);
		row.appendChild(removeBtn);

		fieldsContainer.appendChild(row);
	}

	function autoResize(el) {
		el.style.height = "auto";
		el.style.height = el.scrollHeight + "px";
	}

	// ══════════════════════════════════════════
	// Create mode
	// ══════════════════════════════════════════

	function startCreate() {
		isCreating = true;
		selectedKey = null;

		emptyState.style.display = "none";
		entryForm.classList.remove("hidden");

		entryTypeSelect.value = "article";
		citeKeyInput.value = "";
		citeKeyInput.dataset.originalKey = "";
		deleteBtn.style.display = "none";

		// Populate with default fields for the type
		const defaults = DEFAULT_FIELDS["article"];
		fieldsContainer.innerHTML = "";
		defaults.forEach((f) => addFieldRow(f, ""));

		citeKeyInput.focus();

		renderEntryList();
	}

	// ══════════════════════════════════════════
	// Add a new field to the current form
	// ══════════════════════════════════════════

	function addField() {
		const name = newFieldName.value.trim().toLowerCase();
		if (!name) {
			return;
		}

		// Check for duplicates
		const existing = fieldsContainer.querySelectorAll(".field-name");
		for (const el of existing) {
			if (el.value.toLowerCase() === name) {
				newFieldName.value = "";
				return;
			}
		}

		addFieldRow(name, "");
		newFieldName.value = "";
	}

	// ══════════════════════════════════════════
	// Save
	// ══════════════════════════════════════════

	function saveCurrentEntry() {
		const entryType = entryTypeSelect.value;
		const citeKey = citeKeyInput.value.trim();

		if (!citeKey) {
			citeKeyInput.focus();
			return;
		}

		// Collect fields from the form
		const fields = {};
		const rows = fieldsContainer.querySelectorAll(".field-row");
		rows.forEach((row) => {
			const name = row.querySelector(".field-name").value.trim().toLowerCase();
			const value = row.querySelector(".field-value").value;
			if (name) {
				fields[name] = value;
			}
		});

		if (isCreating) {
			vscode.postMessage({
				type: "createEntry",
				entry: { entryType, citeKey, fields },
			});
			isCreating = false;
			selectedKey = citeKey;
		} else {
			const originalKey = citeKeyInput.dataset.originalKey || citeKey;
			vscode.postMessage({
				type: "updateEntry",
				entry: { originalCiteKey: originalKey, entryType, citeKey, fields },
			});
			selectedKey = citeKey;
		}
	}

	// ══════════════════════════════════════════
	// Delete
	// ══════════════════════════════════════════

	function deleteCurrentEntry() {
		const key = citeKeyInput.dataset.originalKey || citeKeyInput.value.trim();
		if (!key) {
			return;
		}

		vscode.postMessage({
			type: "deleteEntry",
			citeKey: key,
		});

		clearDetail();
	}
})();

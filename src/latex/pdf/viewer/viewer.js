// ============================================================
// InTeX PDF Viewer — continuous-scroll, text-selectable,
// searchable, hyperlink-aware viewer using pdf.js
// ============================================================

(async function () {
	"use strict";

	// ---- Load pdf.js (ES module) ----
	const pdfjsLib = await import(window.__PDFJS_URL__);
	pdfjsLib.GlobalWorkerOptions.workerSrc = window.__PDFJS_WORKER_URL__;

	// ---- VS Code API ----
	const vscode = acquireVsCodeApi();

	// ---- DOM refs ----
	const prevBtn        = document.getElementById("prevBtn");
	const nextBtn        = document.getElementById("nextBtn");
	const pageInput      = document.getElementById("pageInput");
	const pageCountEl    = document.getElementById("pageCount");
	const zoomOutBtn     = document.getElementById("zoomOutBtn");
	const zoomInBtn      = document.getElementById("zoomInBtn");
	const zoomLabel      = document.getElementById("zoomLabel");
	const fitWidthBtn    = document.getElementById("fitWidthBtn");
	const fitPageBtn     = document.getElementById("fitPageBtn");
	const searchBtn      = document.getElementById("searchBtn");
	const sidebarToggle  = document.getElementById("sidebarToggle");
	const searchBar      = document.getElementById("searchBar");
	const searchInput    = document.getElementById("searchInput");
	const searchPrev     = document.getElementById("searchPrev");
	const searchNext     = document.getElementById("searchNext");
	const searchClose    = document.getElementById("searchClose");
	const searchInfo     = document.getElementById("searchInfo");
	const mainView       = document.getElementById("mainView");
	const pagesContainer = document.getElementById("pagesContainer");
	const sidebar        = document.getElementById("sidebar");
	const loadingOverlay = document.getElementById("loadingOverlay");

	// ---- State ----
	let pdfDoc      = null;
	let currentPage = 1;
	let pageCount   = 0;
	let zoom        = 1.0;
	let fitMode     = "width"; // null | "width" | "page"

	const MIN_ZOOM  = 0.25;
	const MAX_ZOOM  = 5.0;
	const THUMB_WIDTH  = 134;
	const THUMB_SCALE  = 0.4;

	// Per-page data
	const pageWrappers = [];   // DOM wrapper elements (one per page)
	const pageCanvases = [];   // canvas elements
	const pageTextDivs = [];   // textLayer div wrappers
	const pageAnnotDivs = [];  // annotationLayer div wrappers
	const pageRendered = [];   // boolean — has been rendered at current zoom?
	const thumbCanvases = [];  // sidebar thumbnail canvases
	const pageTextContents = []; // pdf.js textContent per page (items with transform/width)
	const pageViewports = [];    // viewport at current zoom per page

	// Search state
	let searchResults = [];    // [{pageIdx, itemIdx, item, charStart, charLen}]
	let searchCurrent = -1;
	let searchHighlights = []; // DOM elements to clear

	// Intersection observer for lazy rendering
	let pageObserver = null;

	// ============================================================
	// Toolbar wiring
	// ============================================================

	prevBtn.addEventListener("click", () => scrollToPage(currentPage - 1));
	nextBtn.addEventListener("click", () => scrollToPage(currentPage + 1));

	pageInput.addEventListener("change", () => {
		let p = parseInt(pageInput.value, 10);
		if (isNaN(p) || p < 1) p = 1;
		if (p > pageCount) p = pageCount;
		scrollToPage(p);
	});
	pageInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") pageInput.blur();
	});

	zoomOutBtn.addEventListener("click", () => { fitMode = null; applyZoom(zoom - 0.25); });
	zoomInBtn.addEventListener("click",  () => { fitMode = null; applyZoom(zoom + 0.25); });
	fitWidthBtn.addEventListener("click", () => {
		fitMode = fitMode === "width" ? null : "width";
		reRenderAll();
		updateFitButtons();
	});
	fitPageBtn.addEventListener("click", () => {
		fitMode = fitMode === "page" ? null : "page";
		reRenderAll();
		updateFitButtons();
	});

	// Search bar toggle
	searchBtn.addEventListener("click", toggleSearch);
	searchClose.addEventListener("click", closeSearch);

	// Sidebar toggle
	sidebarToggle.addEventListener("click", toggleSidebar);
	searchInput.addEventListener("input", debounce(runSearch, 300));
	searchInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.shiftKey ? prevSearchResult() : nextSearchResult();
		} else if (e.key === "Escape") {
			closeSearch();
		}
	});
	searchPrev.addEventListener("click", prevSearchResult);
	searchNext.addEventListener("click", nextSearchResult);

	// Keyboard shortcuts
	document.addEventListener("keydown", (e) => {
		const inInput = document.activeElement === pageInput || document.activeElement === searchInput;
		if (inInput) return;

		if ((e.ctrlKey || e.metaKey) && e.key === "f") {
			e.preventDefault();
			toggleSearch();
			return;
		}

		switch (e.key) {
			case "ArrowLeft": case "PageUp":
				e.preventDefault(); scrollToPage(currentPage - 1); break;
			case "ArrowRight": case "PageDown":
				e.preventDefault(); scrollToPage(currentPage + 1); break;
			case "+": case "=":
				e.preventDefault(); fitMode = null; applyZoom(zoom + 0.25); break;
			case "-": case "_":
				e.preventDefault(); fitMode = null; applyZoom(zoom - 0.25); break;
			case "0":
				e.preventDefault(); fitMode = null; applyZoom(1.0); break;
		}
	});

	// Ctrl+Wheel zoom
	mainView.addEventListener("wheel", (e) => {
		if (e.ctrlKey || e.metaKey) {
			e.preventDefault();
			fitMode = null;
			applyZoom(e.deltaY < 0 ? zoom * 1.1 : zoom / 1.1);
		}
	}, { passive: false });

	// Track current page by scroll position
	mainView.addEventListener("scroll", debounce(updateCurrentPageFromScroll, 80));

	// Resize handling
	let resizeTimer;
	window.addEventListener("resize", () => {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(() => {
			if (fitMode) reRenderAll();
		}, 200);
	});

	// ============================================================
	// Zoom helpers
	// ============================================================

	function applyZoom(z) {
		zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
		fitMode = null;
		updateFitButtons();
		reRenderAll();
		vscode.postMessage({ type: "zoomChange", zoom });
		vscode.postMessage({ type: "fitModeChange", fitMode });
	}

	function computeZoom(baseViewport) {
		if (fitMode === "width") {
			const availW = mainView.clientWidth - 40;
			return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, availW / baseViewport.width));
		} else if (fitMode === "page") {
			const availW = mainView.clientWidth - 40;
			const availH = mainView.clientHeight - 40;
			return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM,
				Math.min(availW / baseViewport.width, availH / baseViewport.height)));
		}
		return zoom;
	}

	// ============================================================
	// Controls
	// ============================================================

	function updateControls() {
		prevBtn.disabled = currentPage <= 1;
		nextBtn.disabled = currentPage >= pageCount;
		pageInput.value = currentPage;
		pageCountEl.textContent = pageCount;
		zoomLabel.textContent = Math.round(zoom * 100) + "%";
	}

	function updateCurrentPageFromScroll() {
		if (!pdfDoc || pageWrappers.length === 0) return;
		const viewTop = mainView.scrollTop + mainView.clientHeight / 3;
		let best = 1;
		for (let i = 0; i < pageWrappers.length; i++) {
			if (pageWrappers[i].offsetTop <= viewTop) best = i + 1;
		}
		if (best !== currentPage) {
			currentPage = best;
			updateControls();
			highlightThumb(currentPage);
			vscode.postMessage({ type: "pageChange", page: currentPage });
		}
	}

	// ============================================================
	// Continuous-scroll page rendering
	// ============================================================

	async function buildPageShells() {
		pagesContainer.innerHTML = "";
		pageWrappers.length = 0;
		pageCanvases.length = 0;
		pageTextDivs.length = 0;
		pageAnnotDivs.length = 0;
		pageRendered.length = 0;
		pageTextContents.length = 0;
		pageViewports.length = 0;

		// Disconnect old observer
		if (pageObserver) pageObserver.disconnect();

		for (let i = 1; i <= pageCount; i++) {
			const page = await pdfDoc.getPage(i);
			const baseVP = page.getViewport({ scale: 1.0 });
			const effectiveZoom = computeZoom(baseVP);
			if (i === 1) zoom = effectiveZoom; // sync global zoom on first

			const cssW = Math.floor(baseVP.width * effectiveZoom);
			const cssH = Math.floor(baseVP.height * effectiveZoom);

			// Wrapper per page
			const wrapper = document.createElement("div");
			wrapper.className = "page-wrapper";
			wrapper.dataset.page = i;
			wrapper.style.width = cssW + "px";
			wrapper.style.height = cssH + "px";
			wrapper.style.position = "relative";

			// Canvas
			const cvs = document.createElement("canvas");
			cvs.className = "page-canvas";
			wrapper.appendChild(cvs);

			// Text layer
			const textDiv = document.createElement("div");
			textDiv.className = "textLayer";
			wrapper.appendChild(textDiv);

			// Annotation layer
			const annotDiv = document.createElement("div");
			annotDiv.className = "annotationLayer";
			wrapper.appendChild(annotDiv);

			pagesContainer.appendChild(wrapper);

			pageWrappers.push(wrapper);
			pageCanvases.push(cvs);
			pageTextDivs.push(textDiv);
			pageAnnotDivs.push(annotDiv);
			pageRendered.push(false);
		}

		// Use IntersectionObserver to lazily render visible pages
		pageObserver = new IntersectionObserver((entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					const idx = parseInt(entry.target.dataset.page, 10) - 1;
					if (!pageRendered[idx]) {
						renderPage(idx + 1);
					}
				}
			}
		}, { root: mainView, rootMargin: "200px 0px" });

		pageWrappers.forEach((w) => pageObserver.observe(w));
	}

	async function renderPage(pageNum) {
		const idx = pageNum - 1;
		if (pageRendered[idx]) return;
		pageRendered[idx] = true;

		try {
			const page = await pdfDoc.getPage(pageNum);
			const baseVP = page.getViewport({ scale: 1.0 });
			const effectiveZoom = computeZoom(baseVP);
			const dpr = window.devicePixelRatio || 1;

			const cssW = Math.floor(baseVP.width * effectiveZoom);
			const cssH = Math.floor(baseVP.height * effectiveZoom);

			// Update wrapper size
			const wrapper = pageWrappers[idx];
			wrapper.style.width = cssW + "px";
			wrapper.style.height = cssH + "px";

			// ---- Canvas ----
			const renderScale = effectiveZoom * dpr;
			const vp = page.getViewport({ scale: renderScale });
			const cvs = pageCanvases[idx];
			cvs.width = Math.floor(vp.width);
			cvs.height = Math.floor(vp.height);
			cvs.style.width = cssW + "px";
			cvs.style.height = cssH + "px";

			const ctx = cvs.getContext("2d");
			await page.render({ canvasContext: ctx, viewport: vp }).promise;

			// ---- Text layer (for selection/search) ----
			const textVP = page.getViewport({ scale: effectiveZoom });
			const textContent = await page.getTextContent();
			pageTextContents[idx] = textContent;
			pageViewports[idx] = textVP;

			const textDiv = pageTextDivs[idx];
			textDiv.innerHTML = "";
			textDiv.style.width = cssW + "px";
			textDiv.style.height = cssH + "px";
			textDiv.style.setProperty("--scale-factor", effectiveZoom);

			const textLayer = new pdfjsLib.TextLayer({
				textContentSource: textContent,
				container: textDiv,
				viewport: textVP,
			});
			await textLayer.render();

			// ---- Annotation layer (hyperlinks) ----
			const annotDiv = pageAnnotDivs[idx];
			annotDiv.innerHTML = "";
			annotDiv.style.width = cssW + "px";
			annotDiv.style.height = cssH + "px";

			const annotations = await page.getAnnotations();
			renderAnnotations(annotations, annotDiv, textVP, page);
			highlightAllSearchResults();

		} catch (err) {
			console.error("Render error page " + pageNum, err);
		}
	}

	// ============================================================
	// Annotation / hyperlink rendering
	// ============================================================

	function renderAnnotations(annotations, container, viewport, page) {
		for (const annot of annotations) {
			if (!annot.rect || annot.rect.length < 4) continue;

			// Only handle Link annotations
			if (annot.subtype !== "Link") continue;

			const rect = pdfjsLib.Util.normalizeRect(annot.rect);
			const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect);

			const left = Math.min(x1, x2);
			const top = Math.min(y1, y2);
			const width = Math.abs(x2 - x1);
			const height = Math.abs(y2 - y1);

			const el = document.createElement("a");
			el.className = "pdf-link";
			el.style.left = left + "px";
			el.style.top = top + "px";
			el.style.width = width + "px";
			el.style.height = height + "px";

			if (annot.url) {
				// External URL
				el.href = annot.url;
				el.title = annot.url;
				el.addEventListener("click", (e) => {
					e.preventDefault();
					vscode.postMessage({ type: "openExternal", url: annot.url });
				});
			} else if (annot.dest) {
				// Internal destination
				el.href = "#";
				el.title = "Go to page";
				el.addEventListener("click", async (e) => {
					e.preventDefault();
					try {
						let dest = annot.dest;
						if (typeof dest === "string") {
							dest = await pdfDoc.getDestination(dest);
						}
						if (dest) {
							const pageIdx = await pdfDoc.getPageIndex(dest[0]);
							scrollToPage(pageIdx + 1);
						}
					} catch (err) {
						console.error("Failed to resolve link dest:", err);
					}
				});
			} else if (annot.action === "GoTo" && annot.dest) {
				el.href = "#";
				el.addEventListener("click", async (e) => {
					e.preventDefault();
					try {
						const pageIdx = await pdfDoc.getPageIndex(annot.dest[0]);
						scrollToPage(pageIdx + 1);
					} catch (err) {
						console.error("GoTo link error:", err);
					}
				});
			} else {
				continue; // skip non-link annotations
			}

			container.appendChild(el);
		}
	}

	// ============================================================
	// Navigation
	// ============================================================

	function scrollToPage(page) {
		if (!pdfDoc || page < 1 || page > pageCount) return;
		currentPage = page;
		updateControls();
		highlightThumb(page);
		scrollThumbIntoView(page);

		const wrapper = pageWrappers[page - 1];
		if (wrapper) {
			mainView.scrollTo({ top: wrapper.offsetTop - pagesContainer.offsetTop, behavior: "smooth" });
		}
		vscode.postMessage({ type: "pageChange", page: currentPage });
	}

	async function reRenderAll() {
		if (!pdfDoc) return;

		// Remember scroll percentage
		const scrollFrac = mainView.scrollTop / (mainView.scrollHeight || 1);

		// Mark all as not rendered
		pageRendered.fill(false);

		// Resize all wrappers first (to get correct scroll height)
		for (let i = 1; i <= pageCount; i++) {
			const page = await pdfDoc.getPage(i);
			const baseVP = page.getViewport({ scale: 1.0 });
			const effectiveZoom = computeZoom(baseVP);
			if (i === 1) zoom = effectiveZoom;

			const cssW = Math.floor(baseVP.width * effectiveZoom);
			const cssH = Math.floor(baseVP.height * effectiveZoom);
			pageWrappers[i - 1].style.width = cssW + "px";
			pageWrappers[i - 1].style.height = cssH + "px";

			// Clear old content
			pageCanvases[i - 1].width = 0;
			pageCanvases[i - 1].height = 0;
			pageTextDivs[i - 1].innerHTML = "";
			pageAnnotDivs[i - 1].innerHTML = "";
			pageTextContents[i - 1] = null;
			pageViewports[i - 1] = null;
		}

		updateControls();

		// Restore approximate scroll position
		mainView.scrollTop = scrollFrac * mainView.scrollHeight;

		// The IntersectionObserver will pick up visible pages and render them
		// Force a check for currently visible pages
		for (let i = 0; i < pageWrappers.length; i++) {
			const rect = pageWrappers[i].getBoundingClientRect();
			const mainRect = mainView.getBoundingClientRect();
			if (rect.bottom >= mainRect.top - 200 && rect.top <= mainRect.bottom + 200) {
				if (!pageRendered[i]) renderPage(i + 1);
			}
		}
	}

	// ============================================================
	// Search
	// ============================================================

	function toggleSearch() {
		const visible = !searchBar.classList.contains("hidden");
		if (visible) {
			closeSearch();
		} else {
			searchBar.classList.remove("hidden");
			searchInput.focus();
			searchInput.select();
		}
	}

	function toggleSidebar() {
		const content = document.getElementById("content");
		content.classList.toggle("sidebar-collapsed");
		sidebarToggle.classList.toggle("active");
	}

	function updateFitButtons() {
		fitWidthBtn.classList.toggle("active", fitMode === "width");
		fitPageBtn.classList.toggle("active", fitMode === "page");
	}

	function closeSearch() {
		searchBar.classList.add("hidden");
		clearSearchHighlights();
		searchResults = [];
		searchCurrent = -1;
		searchInfo.textContent = "";
	}

	async function runSearch() {
		clearSearchHighlights();
		searchResults = [];
		searchCurrent = -1;

		const query = searchInput.value.trim().toLowerCase();
		if (!query || !pdfDoc) {
			searchInfo.textContent = "";
			return;
		}

		// Search through pdf.js text content items (same data source as annotations)
		for (let i = 0; i < pageCount; i++) {
			// Ensure page is rendered so text content is available
			if (!pageRendered[i]) await renderPage(i + 1);

			const textContent = pageTextContents[i];
			if (!textContent) continue;

			textContent.items.forEach((item, itemIdx) => {
				if (!item.str) return;
				const text = item.str.toLowerCase();
				let startPos = 0;
				while (true) {
					const idx = text.indexOf(query, startPos);
					if (idx === -1) break;
					searchResults.push({ pageIdx: i, itemIdx, item, charStart: idx, charLen: query.length });
					startPos = idx + 1;
				}
			});
		}

		if (searchResults.length > 0) {
			searchCurrent = 0;
			highlightAllSearchResults();
			scrollToSearchResult(searchCurrent);
			updateSearchInfo();
		} else {
			searchInfo.textContent = "No results";
		}
	}

	function highlightAllSearchResults() {
		clearSearchHighlights();

		for (let i = 0; i < searchResults.length; i++) {
			const r = searchResults[i];
			const item = r.item;
			const viewport = pageViewports[r.pageIdx];
			if (!item || !viewport || !item.str || item.str.length === 0) continue;

			// Compute match rect in PDF coordinate space from text content item,
			// then convert via viewport — same approach as renderAnnotations.
			const t = item.transform; // [scaleX, skewY, skewX, scaleY, tx, ty]
			const tx = t[4];
			const ty = t[5];
			const fontHeight = item.height;
			const itemWidth = item.width;

			// Proportional character offset within the text item
			const fracStart = r.charStart / item.str.length;
			const fracEnd = (r.charStart + r.charLen) / item.str.length;

			// Build rect in PDF user-space [x1, y1, x2, y2]
			const x1 = tx + fracStart * itemWidth;
			const x2 = tx + fracEnd * itemWidth;
			const y1 = ty;
			const y2 = ty + fontHeight;

			// Convert to viewport coordinates — identical to annotation/hyperlink path
			const rect = pdfjsLib.Util.normalizeRect([x1, y1, x2, y2]);
			const [vx1, vy1, vx2, vy2] = viewport.convertToViewportRectangle(rect);

			const left = Math.min(vx1, vx2);
			const top = Math.min(vy1, vy2);
			const width = Math.abs(vx2 - vx1);
			const height = Math.abs(vy2 - vy1);

			const highlight = document.createElement("div");
			highlight.className = "search-highlight" + (i === searchCurrent ? " active" : "");
			highlight.style.left = left + "px";
			highlight.style.top = top + "px";
			highlight.style.width = width + "px";
			highlight.style.height = height + "px";

			pageWrappers[r.pageIdx].appendChild(highlight);
			searchHighlights.push(highlight);
		}
	}

	function clearSearchHighlights() {
		searchHighlights.forEach((el) => el.remove());
		searchHighlights = [];
	}

	function nextSearchResult() {
		if (searchResults.length === 0) return;
		searchCurrent = (searchCurrent + 1) % searchResults.length;
		highlightAllSearchResults();
		scrollToSearchResult(searchCurrent);
		updateSearchInfo();
	}

	function prevSearchResult() {
		if (searchResults.length === 0) return;
		searchCurrent = (searchCurrent - 1 + searchResults.length) % searchResults.length;
		highlightAllSearchResults();
		scrollToSearchResult(searchCurrent);
		updateSearchInfo();
	}

	function scrollToSearchResult(idx) {
		const r = searchResults[idx];
		if (!r) return;
		const pageNum = r.pageIdx + 1;

		// Scroll page into view
		const wrapper = pageWrappers[r.pageIdx];
		if (wrapper) {
			mainView.scrollTo({ top: wrapper.offsetTop - pagesContainer.offsetTop, behavior: "smooth" });
		}
		currentPage = pageNum;
		updateControls();
		highlightThumb(pageNum);
		scrollThumbIntoView(pageNum);
		vscode.postMessage({ type: "pageChange", page: currentPage });

		// Scroll the active highlight into view
		setTimeout(() => {
			const activeMark = document.querySelector(".search-highlight.active");
			if (activeMark) {
				const markTop = activeMark.offsetParent.offsetTop + activeMark.offsetTop;
				const target = markTop - pagesContainer.offsetTop - mainView.clientHeight / 2;
				mainView.scrollTo({ top: target, behavior: "smooth" });
			}
		}, 150);
	}

	function updateSearchInfo() {
		if (searchResults.length === 0) {
			searchInfo.textContent = "No results";
		} else {
			searchInfo.textContent = `${searchCurrent + 1} of ${searchResults.length}`;
		}
	}

	// ============================================================
	// Thumbnails
	// ============================================================

	async function buildThumbnails() {
		if (!pdfDoc) return;
		sidebar.innerHTML = "";
		thumbCanvases.length = 0;

		for (let i = 1; i <= pageCount; i++) {
			const item = document.createElement("div");
			item.className = "thumb-item" + (i === currentPage ? " selected" : "");
			item.dataset.page = i;

			const cvs = document.createElement("canvas");
			item.appendChild(cvs);

			const lbl = document.createElement("div");
			lbl.className = "thumb-label";
			lbl.textContent = i;
			item.appendChild(lbl);

			item.addEventListener("click", () => scrollToPage(i));
			sidebar.appendChild(item);
			thumbCanvases.push(cvs);
		}

		renderThumbnailsBatch(1);
	}

	async function renderThumbnailsBatch(startPage) {
		const BATCH = 4;
		const end = Math.min(startPage + BATCH - 1, pageCount);
		const promises = [];
		for (let i = startPage; i <= end; i++) promises.push(renderThumbnail(i));
		await Promise.all(promises);
		if (end < pageCount) requestAnimationFrame(() => renderThumbnailsBatch(end + 1));
	}

	async function renderThumbnail(pageNum) {
		try {
			const page = await pdfDoc.getPage(pageNum);
			const vp = page.getViewport({ scale: THUMB_SCALE });
			const cvs = thumbCanvases[pageNum - 1];
			if (!cvs) return;
			cvs.width = Math.floor(vp.width);
			cvs.height = Math.floor(vp.height);
			cvs.style.width = THUMB_WIDTH + "px";
			cvs.style.height = Math.floor(vp.height * (THUMB_WIDTH / vp.width)) + "px";
			const tctx = cvs.getContext("2d");
			await page.render({ canvasContext: tctx, viewport: vp }).promise;
		} catch (err) {
			console.error("Thumb render error page " + pageNum, err);
		}
	}

	function highlightThumb(page) {
		sidebar.querySelectorAll(".thumb-item").forEach((el) => {
			el.classList.toggle("selected", parseInt(el.dataset.page, 10) === page);
		});
	}

	function scrollThumbIntoView(page) {
		const el = sidebar.querySelector(`.thumb-item[data-page="${page}"]`);
		if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
	}

	// ============================================================
	// PDF loading
	// ============================================================

	async function loadPDF(pdfData) {
		try {
			loadingOverlay.classList.remove("hidden");

			pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
			pageCount = pdfDoc.numPages;
			currentPage = Math.max(1, Math.min(currentPage, pageCount));

			updateControls();
			await buildPageShells();
			buildThumbnails();

			loadingOverlay.classList.add("hidden");
		} catch (err) {
			console.error("PDF load error:", err);
			loadingOverlay.textContent = "Failed to load PDF: " + err.message;
		}
	}

	// ============================================================
	// Messaging with extension host
	// ============================================================

	window.addEventListener("message", (event) => {
		const msg = event.data;
		switch (msg.type) {
			case "loadPdf": {
				const bin = atob(msg.data);
				const bytes = new Uint8Array(bin.length);
				for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
				loadPDF(bytes);
				break;
			}
			case "scrollToPosition":
				if (msg.page) scrollToPage(msg.page);
				break;
		}
	});

	// ============================================================
	// Utility
	// ============================================================

	function debounce(fn, ms) {
		let timer;
		return function (...args) {
			clearTimeout(timer);
			timer = setTimeout(() => fn.apply(this, args), ms);
		};
	}

	// Signal ready
	vscode.postMessage({ type: "ready" });
})();

use std::cell::RefCell;

slint::include_modules!();

thread_local! {
	static APP: RefCell<Option<slint::Weak<PDFViewer>>> = RefCell::new(None);
}

#[cfg_attr(target_arch = "wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub fn start_ui() {
	let app = PDFViewer::new().unwrap();

	// Store a weak reference so load_pdf can access the app later
	APP.with(|cell| {
		*cell.borrow_mut() = Some(app.as_weak());
	});

	app.run().unwrap();
}

#[cfg(not(target_arch = "wasm32"))]
fn main() {
	start_ui();
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn load_pdf(data: &[u8]) {
	APP.with(|cell| {
		let borrow = cell.borrow();
		if let Some(weak) = borrow.as_ref() {
			if let Some(app) = weak.upgrade() {
				match lopdf::Document::load_mem(data) {
					Ok(doc) => {
						let page_count = doc.get_pages().len() as i32;
						app.set_pageCount(page_count);
						app.set_textContent(slint::SharedString::from(format!(
							"PDF loaded successfully\nPages: {}\nVersion: {}",
							page_count, doc.version
						)));
					}
					Err(e) => {
						app.set_textContent(slint::SharedString::from(format!(
							"Error loading PDF: {}",
							e
						)));
					}
				}
			}
		}
	});
}

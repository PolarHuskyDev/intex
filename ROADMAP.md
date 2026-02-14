# ∫TeX ROADMAP

## PDF Viewer - Planned
The current implementation is top notch but there are certain features we may introduce to enhance it even further
- Selectable text: this should enable users to copy around parts of the pdf text. And also enables adding labels/comments in the selected text (future collaborative features) within the PDF viewer

## Embedded latex engine (WASM LaTeX) - Preliminary exploration
This will really lower user entry level by not requiring any external dependency (texlive or docker to compile documents). That certainly will be much appreciated and will be very useful for new users and web distributions of vscode (vscode in the browser) therefore allowing to skip local latex installation completely.

The same logic applies to other latex tools like synctex and LSP server 

## Mendelay/Zotero integration - Planned
This is a most-requested features from the academic world and will help users to keep their readings in sync with their citations. A really cool and nice feature.

## Visual advanced editors - Partially done
∫TeX does not aim to be a WYSIWYG editor, yet we currently support a side panel editor for some common objects:
- Equations
- Tables (simple plain tables)
- Simple figures with included graphics (PNG, JPG)
- Simple BibTex entries

But we may introduce new advanced visual editors for:
- Complex tables with `\multirow` and `\multicolumn` support
- Figures with more advanced diagramming capabilities like tikz, circuitikz (electronic diagrams), xskak (chess), Pgfplots (function mathematical plots), modiagram (molecular orbital diagrams), tikz-feynman (Feynman diagrams), chemfig (structural chemical formulae), mhchem (Chemical formulae and equations), 

> Note: That the not having visual editors does not mean not being able to generate documents with such feature.

---

## Hover previews - Research for improvement
Even though we supported hover previews in an older version we removed that implementation because we considered it inefficient and buggy. It worked by rendering the element in a standalone latex document which proved to be slow and barely usable in a daily basis. We are currently investigating better ways to generate fast and reliable hover previews

## Templates - Preliminary exploration  
We are exploring the possibility to offer document templates for various type of documents (Thesis, slides, articles, letter, books, etc) or even creating a marketplace for them so all the users may share or sell their templates through the platform.


## Advanced language and grammar checking - Preliminary exploration and Research
Having build-in grammar and spelling checks is certainly a major task due to the immense catalog of languages in the world and the complexity of their grammar rules and spelling rules. Tackling such a big endeavor may be doable in the long run and is a pending feature with no clear implementation date or path yet.

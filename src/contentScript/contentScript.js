function notifyExtension() {
	browser.runtime.sendMessage({ type: "clip", dom: content });
}

function getHTMLOfDocument() {
	let baseEl = document.createElement("base");

	let baseEls = document.head.getElementsByTagName("base");
	if (baseEls.length > 0) {
		baseEl = baseEls[0];
	} else {
		document.head.append(baseEl);
	}

	if (!baseEl.getAttribute("href")) {
		baseEl.setAttribute("href", window.location.href);
	}

	removeHiddenNodes(document.body);

	return document.documentElement.outerHTML;
}

function removeHiddenNodes(root) {
	let nodeIterator,
		node,
		i = 0;

	nodeIterator = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT, function (node) {
		let nodeName = node.nodeName.toLowerCase();
		if (nodeName === "script" || nodeName === "style" || nodeName === "noscript" || nodeName === "math") {
			return NodeFilter.FILTER_REJECT;
		}
		if (node.offsetParent === void 0) {
			return NodeFilter.FILTER_ACCEPT;
		}
		let computedStyle = window.getComputedStyle(node, null);
		if (
			computedStyle.getPropertyValue("visibility") === "hidden" ||
			computedStyle.getPropertyValue("display") === "none"
		) {
			return NodeFilter.FILTER_ACCEPT;
		}
	});

	while ((node = nodeIterator.nextNode())) {
		if (++i && node.parentNode instanceof HTMLElement) {
			node.parentNode.removeChild(node);
		}
	}

	return root;
}

function getHTMLOfSelection() {
	let range;
	if (document.selection?.createRange) {
		range = document.selection.createRange();
		return range.htmlText;
	} else if (window.getSelection) {
		const selection = window.getSelection();
		if (selection.rangeCount > 0) {
			let content = "";
			for (let i = 0; i < selection.rangeCount; i++) {
				range = selection.getRangeAt(0);
				const clonedSelection = range.cloneContents();
				const div = document.createElement("div");
				div.appendChild(clonedSelection);
				content += div.innerHTML;
			}
			return content;
		} else {
			return "";
		}
	} else {
		return "";
	}
}

function getSelectionAndDom() {
	return {
		selection: getHTMLOfSelection(),
		dom: getHTMLOfDocument(),
	};
}

function copyToClipboard(text) {
	navigator.clipboard.writeText(text);
}

function downloadMarkdown(filename, text) {
	const mdClipsFolder = options.mdClipsFolder || "pages";
	const clipsPath = `${mdClipsFolder}/${filename}`;
	let datauri = `data:text/markdown;base64,${btoa(decodeURI(encodeURIComponent(text)))}`;
	const link = document.createElement("a");
	link.download = clipsPath;
	link.href = datauri;
	link.click();
}

function downloadImage(filename, url) {
	const mdAssetsFolder = options.mdAssetsFolder || "assets";
	const assetPath = `${mdAssetsFolder}/${filename}`;

	fetch(url)
		.then((response) => response.blob())
		.then((blob) => {
			const link = document.createElement("a");
			link.download = assetPath;
			link.href = window.URL.createObjectURL(blob);
			link.click();
		})
		.catch(console.error);
}

(function loadPageContextScript() {
	let s = document.createElement("script");
	s.src = browser.runtime.getURL("contentScript/pageContext.js");
	(document.head || document.documentElement).appendChild(s);
})();

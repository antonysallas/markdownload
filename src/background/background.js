browser.runtime.getPlatformInfo().then(async (platformInfo) => {
	const browserInfo = browser.runtime.getBrowserInfo
		? await browser.runtime.getBrowserInfo()
		: "Can't get browser info";
	console.info(platformInfo, browserInfo);
});

browser.runtime.onMessage.addListener(notify);
createMenus();

TurndownService.prototype.defaultEscape = TurndownService.prototype.escape;

function turndown(content, options, article) {
	if (options.turndownEscape) TurndownService.prototype.escape = TurndownService.prototype.defaultEscape;
	else TurndownService.prototype.escape = (s) => s;

	let turndownService = new TurndownService(options);

	turndownService.use(turndownPluginGfm.gfm);

	turndownService.keep(["iframe", "sub", "sup", "u", "ins", "del", "small", "big"]);

	let imageList = {};
	turndownService.addRule("images", {
		filter: function (node, tdopts) {
			if (isImageNode(node)) {
				handleImageNode(node, article.baseURI, options, imageList);
				return true;
			}
			return false;
		},
		replacement: function (content, node, tdopts) {
			return getImageReplacement(node, options);
		},
		references: [],
		append: function (options) {
			return appendReferences(this);
		},
	});

	function isImageNode(node) {
		return node.nodeName == "IMG" && node.getAttribute("src");
	}

	function handleImageNode(node, baseURI, options, imageList) {
		const src = node.getAttribute("src");
		node.setAttribute("src", validateUri(src, baseURI));
		if (options.downloadImages) {
			const imageFilename = generateImageFilename(src, options, imageList);
			const localSrc = getLocalSrc(imageFilename, options);
			if (options.imageStyle != "originalSource" && options.imageStyle != "base64") {
				node.setAttribute("src", localSrc);
			}
		}
	}

	function generateImageFilename(src, options, imageList) {
		let imageFilename = getImageFilename(src, options, false);
		if (!imageList[src] || imageList[src] != imageFilename) {
			imageFilename = differentiateFilename(imageFilename, imageList);
			imageList[src] = imageFilename;
		}
		return imageFilename;
	}

	function differentiateFilename(imageFilename, imageList) {
		let i = 1;
		while (Object.values(imageList).includes(imageFilename)) {
			const parts = imageFilename.split(".");
			if (i == 1) parts.splice(parts.length - 1, 0, i++);
			else parts.splice(parts.length - 2, 1, i++);
			imageFilename = parts.join(".");
		}
		return imageFilename;
	}

	function getLocalSrc(imageFilename, options) {
		const obsidianLink = options.imageStyle.startsWith("obsidian");
		return options.imageStyle === "obsidian-nofolder"
			? imageFilename.substring(imageFilename.lastIndexOf("/") + 1)
			: imageFilename
					.split("/")
					.map((s) => (obsidianLink ? s : encodeURI(s)))
					.join("/");
	}

	function getImageReplacement(node, options) {
		if (options.imageStyle == "noImage") return "";
		else if (options.imageStyle.startsWith("obsidian")) return `![[${node.getAttribute("src")}]]`;
		else {
			return getMarkdownImageReplacement(node, options);
		}
	}

	function getMarkdownImageReplacement(node, options) {
		const alt = cleanAttribute(node.getAttribute("alt"));
		const src = node.getAttribute("src") || "";
		const title = cleanAttribute(node.getAttribute("title"));
		const titlePart = title ? ` "${title}"` : "";
		if (options.imageRefStyle == "referenced") {
			const id = this.references.length + 1;
			this.references.push(`[fig${id}]: ${src}${titlePart}`);
			return `![${alt}][fig${id}]`;
		} else {
			return src ? `![${alt}](${src}${titlePart})` : "";
		}
	}

	function appendReferences(context) {
		if (context.references.length) {
			const references = "\n\n" + context.references.join("\n") + "\n\n";
			return references;
		}
		return "";
	}

	turndownService.addRule("links", {
		filter: (node, tdopts) => {
			if (node.nodeName == "A" && node.getAttribute("href")) {
				const href = node.getAttribute("href");
				node.setAttribute("href", validateUri(href, article.baseURI));
				return options.linkStyle == "stripLinks";
			}
			return false;
		},
		replacement: (content, node, tdopts) => content,
	});

	turndownService.addRule("mathjax", {
		filter(node, options) {
			return article.math.hasOwnProperty(node.id);
		},
		replacement(content, node, options) {
			const math = article.math[node.id];
			let tex = math.tex.trim().replaceAll("\xa0", "");

			if (math.inline) {
				tex = tex.replaceAll("\n", " ");
				return `$${tex}$`;
			} else return `$$\n${tex}\n$$`;
		},
	});

	function repeat(character, count) {
		return Array(count + 1).join(character);
	}

	function convertToFencedCodeBlock(node, options) {
		node.innerHTML = node.innerHTML.replaceAll("<br-keep></br-keep>", "<br>");
		const langMatch = node.id?.match(/code-lang-(.+)/);
		const language = langMatch?.length > 0 ? langMatch[1] : "";

		let code;

		if (language) {
			let div = document.createElement("div");
			document.body.appendChild(div);
			div.appendChild(node);
			code = node.innerText;
			div.remove();
		} else {
			code = node.innerHTML;
		}

		let fenceChar = options.fence.charAt(0);
		let fenceSize = 3;
		let fenceInCodeRegex = new RegExp("^" + fenceChar + "{3,}", "gm");

		let match;
		while ((match = fenceInCodeRegex.exec(code))) {
			if (match[0].length >= fenceSize) {
				fenceSize = match[0].length + 1;
			}
		}

		let fence = repeat(fenceChar, fenceSize);

		return "\n\n" + fence + language + "\n" + code.replace(/\n$/, "") + "\n" + fence + "\n\n";
	}

	turndownService.addRule("fencedCodeBlock", {
		filter: function (node, options) {
			return (
				options.codeBlockStyle === "fenced" &&
				node.nodeName === "PRE" &&
				node.firstChild &&
				node.firstChild.nodeName === "CODE"
			);
		},
		replacement: function (content, node, options) {
			return convertToFencedCodeBlock(node.firstChild, options);
		},
	});

	turndownService.addRule("pre", {
		filter: (node, tdopts) => node.nodeName == "PRE" && (!node.firstChild || node.firstChild.nodeName != "CODE"),
		replacement: (content, node, tdopts) => {
			return convertToFencedCodeBlock(node, tdopts);
		},
	});

	let markdown = options.frontmatter + turndownService.turndown(content) + options.backmatter;

	const controlCharsRegex =
		/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028\u2029\ufeff\ufff9-\ufffc]/g;

	markdown = markdown.replace(controlCharsRegex, "");

	return { markdown: markdown, imageList: imageList };
}

function cleanAttribute(attribute) {
	return attribute ? attribute.replace(/(\n+\s*)+/g, "\n") : "";
}

function validateUri(href, baseURI) {
	try {
		new URL(href);
	} catch {
		const baseUri = new URL(baseURI);

		if (href.startsWith("/")) {
			href = baseUri.origin + href;
		} else {
			href = baseUri.href + (baseUri.href.endsWith("/") ? "/" : "") + href;
		}
	}
	return href;
}

function getImageFilename(src, options, prependFilePath = true) {
	const slashPos = src.lastIndexOf("/");
	const queryPos = src.indexOf("?");
	let filename = src.substring(slashPos + 1, queryPos > 0 ? queryPos : src.length);

	let imagePrefix = options.imagePrefix || "";

	if (prependFilePath && options.title.includes("/")) {
		imagePrefix = options.title.substring(0, options.title.lastIndexOf("/") + 1) + imagePrefix;
	} else if (prependFilePath) {
		imagePrefix = options.title + (imagePrefix.startsWith("/") ? "" : "/") + imagePrefix;
	}

	if (filename.includes(";base64,")) {
		filename = "image." + filename.substring(0, filename.indexOf(";"));
	}

	let extension = filename.substring(filename.lastIndexOf("."));
	if (extension == filename) {
		filename = filename + ".idunno";
	}

	filename = generateValidFileName(filename, options.disallowedChars);

	return imagePrefix + filename;
}

function textReplace(string, article, disallowedChars = null) {
	for (const key in article) {
		if (article.hasOwnProperty(key) && key != "content") {
			let s = (article[key] || "") + "";
			if (s && disallowedChars) s = this.generateValidFileName(s, disallowedChars);

			string = string
				.replace(new RegExp("{" + key + "}", "g"), s)
				.replace(new RegExp("{" + key + ":kebab}", "g"), s.replace(/ /g, "-").toLowerCase())
				.replace(new RegExp("{" + key + ":snake}", "g"), s.replace(/ /g, "_").toLowerCase())
				.replace(
					new RegExp("{" + key + ":camel}", "g"),
					s.replace(/ ./g, (str) => str.trim().toUpperCase()).replace(/^./, (str) => str.toLowerCase())
				)
				.replace(
					new RegExp("{" + key + ":pascal}", "g"),
					s.replace(/ ./g, (str) => str.trim().toUpperCase()).replace(/^./, (str) => str.toUpperCase())
				);
		}
	}

	const now = new Date();
	const dateRegex = /{date:(.+?)}/g;
	const matches = string.match(dateRegex);
	if (matches?.forEach) {
		matches.forEach((match) => {
			const format = match.substring(6, match.length - 1);
			const dateString = moment(now).format(format);
			string = string.replaceAll(match, dateString);
		});
	}

	const keywordRegex = /{keywords:(.*?)}/g;
	const keywordMatches = string.match(keywordRegex);
	if (keywordMatches?.forEach) {
		keywordMatches.forEach((match) => {
			let seperator = match.substring(10, match.length - 1);
			try {
				seperator = JSON.parse(JSON.stringify(seperator).replace(/\\\\/g, "\\"));
			} catch {}
			const keywordsString = (article.keywords || []).join(seperator);
			string = string.replace(new RegExp(match.replace(/\\/g, "\\\\"), "g"), keywordsString);
		});
	}

	const defaultRegex = /{(.*?)}/g;
	string = string.replace(defaultRegex, "");

	return string;
}

async function convertArticleToMarkdown(article, downloadImages = null) {
	const options = await getOptions();
	if (downloadImages != null) {
		options.downloadImages = downloadImages;
	}

	if (options.includeTemplate) {
		options.frontmatter = textReplace(options.frontmatter, article) + "\n";
		options.backmatter = "\n" + textReplace(options.backmatter, article);
	} else {
		options.frontmatter = options.backmatter = "";
	}

	options.imagePrefix = textReplace(options.imagePrefix, article, options.disallowedChars)
		.split("/")
		.map((s) => generateValidFileName(s, options.disallowedChars))
		.join("/");

	let result = turndown(article.content, options, article);
	if (options.downloadImages && options.downloadMode == "downloadsApi") {
		result = await preDownloadImages(result.imageList, result.markdown);
	}
	return result;
}

function generateValidFileName(title, disallowedChars = null) {
	const illegalRe = /[/?<>\\:*|"]/g;

	if (!title) return title;
	else title = title + "";
	let fileName = title.replace(illegalRe, "").replace(/\u00A0/g, " ");

	if (disallowedChars) {
		for (const c of disallowedChars) {
			const charToReplace = `[\\^$.|?*+()`.includes(c) ? `\\${c}` : c;
			fileName = fileName.replace(new RegExp(charToReplace, "g"), "");
		}
	}
	return fileName;
}

async function preDownloadImages(imageList, markdown) {
	const options = await getOptions();
	let newImageList = {};
	await Promise.all(
		Object.entries(imageList).map(([src, filename]) => downloadImage(src, filename, markdown, newImageList, options))
	);

	return { imageList: newImageList, markdown: markdown };
}

function downloadImage(src, filename, markdown, newImageList, options) {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("GET", src);
		xhr.responseType = "blob";
		xhr.onload = async function () {
			const blob = xhr.response;

			if (options.imageStyle == "base64") {
				convertToBase64(blob, src, markdown, resolve);
			} else {
				await handleBlob(blob, filename, src, markdown, newImageList, options);
				resolve();
			}
		};
		xhr.onerror = function () {
			reject("A network error occurred attempting to download " + src);
		};
		xhr.send();
	});
}

function convertToBase64(blob, src, markdown, resolve) {
	let reader = new FileReader();
	reader.onloadend = function () {
		markdown = markdown.replaceAll(src, reader.result);
		resolve();
	};
	reader.readAsDataURL(blob);
}

async function handleBlob(blob, filename, src, markdown, newImageList, options) {
	let newFilename = filename;
	if (newFilename.endsWith(".idunno")) {
		newFilename = filename.replace(".idunno", "." + mimedb[blob.type]);

		if (!options.imageStyle.startsWith("obsidian")) {
			markdown = markdown.replaceAll(
				filename
					.split("/")
					.map((s) => encodeURI(s))
					.join("/"),
				newFilename
					.split("/")
					.map((s) => encodeURI(s))
					.join("/")
			);
		} else {
			markdown = markdown.replaceAll(filename, newFilename);
		}
	}

	const blobUrl = URL.createObjectURL(blob);

	newImageList[blobUrl] = newFilename;

	return markdown;
}

async function downloadMarkdown(markdown, title, tabId, imageList = {}, mdClipsFolder = "", mdAssetsFolder = "") {
	const options = await getOptions();

	if (options.downloadMode == "downloadsApi" && browser.downloads) {
		const url = URL.createObjectURL(
			new Blob([markdown], {
				type: "text/markdown;charset=utf-8",
			})
		);

		try {
			if (mdClipsFolder && !mdClipsFolder.endsWith("/")) mdClipsFolder += "/";
			if (mdAssetsFolder && !mdAssetsFolder.endsWith("/")) mdAssetsFolder += "/";

			const id = await browser.downloads.download({
				url: url,
				filename: mdClipsFolder + title + ".md",
				saveAs: options.saveAs,
			});

			browser.downloads.onChanged.addListener(downloadListener(id, url));

			if (options.downloadImages) {
				Object.entries(imageList).forEach(async ([src, filename]) => {
					const imgId = await browser.downloads.download({
						url: src,
						filename: mdAssetsFolder + filename,
						saveAs: false,
					});
					browser.downloads.onChanged.addListener(downloadListener(imgId, src));
				});
			}
		} catch (err) {
			console.error("Download failed", err);
		}
	} else {
		try {
			await ensureScripts(tabId);
			const filename = mdClipsFolder + generateValidFileName(title, options.disallowedChars) + ".md";
			const code = `downloadMarkdown("${filename}","${base64EncodeUnicode(markdown)}");`;
			await browser.tabs.executeScript(tabId, { code: code });
		} catch (error) {
			console.error("Failed to execute script: " + error);
		}
	}
}

function downloadListener(id, url) {
	const self = (delta) => {
		if (delta.id === id && delta.state && delta.state.current == "complete") {
			browser.downloads.onChanged.removeListener(self);
			//release the url for the blob
			URL.revokeObjectURL(url);
		}
	};
	return self;
}

function base64EncodeUnicode(str) {
	const utf8Bytes = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function (match, p1) {
		return String.fromCharCode("0x" + p1);
	});

	return btoa(utf8Bytes);
}

//function that handles messages from the injected script into the site
async function notify(message) {
	if (message.type == "clip") {
		const article = await getArticleFromDom(message.dom);

		if (message.selection && message.clipSelection) {
			article.content = message.selection;
		}

		const { markdown, imageList } = await convertArticleToMarkdown(article);

		article.title = await formatTitle(article);

		const mdClipsFolder = await formatMdClipsFolder(article);

		await browser.runtime.sendMessage({
			type: "display.md",
			markdown: markdown,
			article: article,
			imageList: imageList,
			mdClipsFolder: mdClipsFolder,
		});
	} else if (message.type == "download") {
		downloadMarkdown(message.markdown, message.title, message.tab.id, message.imageList, message.mdClipsFolder);
	}
}

browser.commands.onCommand.addListener(function (command) {
	const tab = browser.tabs.getCurrent();
	if (command == "download_tab_as_markdown") {
		const info = { menuItemId: "download-markdown-all" };
		downloadMarkdownFromContext(info, tab);
	} else if (command == "copy_tab_as_markdown") {
		const info = { menuItemId: "copy-markdown-all" };
		copyMarkdownFromContext(info, tab);
	} else if (command == "copy_selection_as_markdown") {
		const info = { menuItemId: "copy-markdown-selection" };
		copyMarkdownFromContext(info, tab);
	} else if (command == "copy_tab_as_markdown_link") {
		copyTabAsMarkdownLink(tab);
	} else if (command == "copy_selected_tab_as_markdown_link") {
		copySelectedTabAsMarkdownLink(tab);
	} else if (command == "copy_selection_to_obsidian") {
		const info = { menuItemId: "copy-markdown-obsidian" };
		copyMarkdownFromContext(info, tab);
	} else if (command == "copy_tab_to_obsidian") {
		const info = { menuItemId: "copy-markdown-obsall" };
		copyMarkdownFromContext(info, tab);
	}
});

browser.contextMenus.onClicked.addListener(function (info, tab) {
	if (info.menuItemId.startsWith("copy-markdown")) {
		copyMarkdownFromContext(info, tab);
	} else if (info.menuItemId == "download-markdown-alltabs" || info.menuItemId == "tab-download-markdown-alltabs") {
		downloadMarkdownForAllTabs(info);
	} else if (info.menuItemId.startsWith("download-markdown")) {
		downloadMarkdownFromContext(info, tab);
	} else if (info.menuItemId.startsWith("copy-tab-as-markdown-link-all")) {
		copyTabAsMarkdownLinkAll(tab);
	} else if (info.menuItemId.startsWith("copy-tab-as-markdown-link-selected")) {
		copySelectedTabAsMarkdownLink(tab);
	} else if (info.menuItemId.startsWith("copy-tab-as-markdown-link")) {
		copyTabAsMarkdownLink(tab);
	} else if (info.menuItemId.startsWith("toggle-") || info.menuItemId.startsWith("tabtoggle-")) {
		toggleSetting(info.menuItemId.split("-")[1]);
	}
});

async function toggleSetting(setting, options = null) {
	if (options == null) {
		await toggleSetting(setting, await getOptions());
	} else {
		options[setting] = !options[setting];
		await browser.storage.sync.set(options);
		if (setting == "includeTemplate") {
			browser.contextMenus.update("toggle-includeTemplate", {
				checked: options.includeTemplate,
			});
			try {
				browser.contextMenus.update("tabtoggle-includeTemplate", {
					checked: options.includeTemplate,
				});
			} catch {}
		}

		if (setting == "downloadImages") {
			browser.contextMenus.update("toggle-downloadImages", {
				checked: options.downloadImages,
			});
			try {
				browser.contextMenus.update("tabtoggle-downloadImages", {
					checked: options.downloadImages,
				});
			} catch {}
		}
	}
}

async function ensureScripts(tabId) {
	const results = await browser.tabs.executeScript(tabId, { code: "typeof getSelectionAndDom === 'function';" });
	if (!results || results[0] !== true) {
		try {
			await browser.tabs.executeScript(tabId, { file: "/contentScript/contentScript.js" });
		} catch (error) {
			console.error("Failed to execute script:", error);
		}
	}
}

async function getArticleFromDom(domString) {
	const parser = new DOMParser();
	const dom = parser.parseFromString(domString, "text/html");

	if (dom.documentElement.nodeName == "parsererror") {
		console.error("error while parsing");
	}

	const math = {};

	const storeMathInfo = (el, mathInfo) => {
		let randomId = URL.createObjectURL(new Blob([]));
		randomId = randomId.substring(randomId.length - 36);
		el.id = randomId;
		math[randomId] = mathInfo;
	};

	dom.body.querySelectorAll("script[id^=MathJax-Element-]")?.forEach((mathSource) => {
		const type = mathSource.attributes.type.value;
		storeMathInfo(mathSource, {
			tex: mathSource.innerText,
			inline: type ? !type.includes("mode=display") : false,
		});
	});

	dom.body.querySelectorAll("[markdownload-latex]")?.forEach((mathJax3Node) => {
		const tex = mathJax3Node.getAttribute("markdownload-latex");
		const display = mathJax3Node.getAttribute("display");
		const inline = !(display && display === "true");

		const mathNode = document.createElement(inline ? "i" : "p");
		mathNode.textContent = tex;
		mathJax3Node.parentNode.insertBefore(mathNode, mathJax3Node.nextSibling);
		mathJax3Node.parentNode.removeChild(mathJax3Node);

		storeMathInfo(mathNode, {
			tex: tex,
			inline: inline,
		});
	});

	dom.body.querySelectorAll(".katex-mathml")?.forEach((kaTeXNode) => {
		storeMathInfo(kaTeXNode, {
			tex: kaTeXNode.querySelector("annotation").textContent,
			inline: true,
		});
	});

	dom.body.querySelectorAll("[class*=highlight-text],[class*=highlight-source]")?.forEach((codeSource) => {
		const regex = /highlight-(?:text|source)-([a-z0-9]+)/;
		const match = regex.exec(codeSource.className);
		const language = match ? match[1] : null;
		if (language && codeSource.firstChild.nodeName === "PRE") {
			codeSource.firstChild.id = `code-lang-${language}`;
		}
	});

	dom.body.querySelectorAll("[class*=language-]")?.forEach((codeSource) => {
		const regex = /language-([a-z0-9]+)/;
		const match = regex.exec(codeSource.className);
		const language = match ? match[1] : null;
		if (language) {
			codeSource.id = `code-lang-${language}`;
		}
	});

	dom.body.querySelectorAll("pre br")?.forEach((br) => {
		br.outerHTML = "<br-keep></br-keep>";
	});

	dom.body.querySelectorAll(".codehilite > pre")?.forEach((codeSource) => {
		if (codeSource.firstChild.nodeName !== "CODE" && !codeSource.className.includes("language")) {
			codeSource.id = `code-lang-text`;
		}
	});

	dom.body.querySelectorAll("h1, h2, h3, h4, h5, h6")?.forEach((header) => {
		header.className = "";
	});

	const article = new Readability(dom).parse();

	article.baseURI = dom.baseURI;
	article.pageTitle = dom.title;
	const url = new URL(dom.baseURI);
	article.hash = url.hash;
	article.host = url.host;
	article.origin = url.origin;
	article.hostname = url.hostname;
	article.pathname = url.pathname;
	article.port = url.port;
	article.protocol = url.protocol;
	article.search = url.search;

	if (dom.head) {
		article.keywords = dom.head
			.querySelector('meta[name="keywords"]')
			?.content?.split(",")
			?.map((s) => s.trim());

		dom.head.querySelectorAll("meta[name][content], meta[property][content]")?.forEach((meta) => {
			const key = meta.getAttribute("name") || meta.getAttribute("property");
			const val = meta.getAttribute("content");
			if (key && val && !article[key]) {
				article[key] = val;
			}
		});
	}

	article.math = math;

	return article;
}

async function getArticleFromContent(tabId, selection = false) {
	const results = await browser.tabs.executeScript(tabId, { code: "getSelectionAndDom()" });
	if (results?.[0]?.dom) {
		const article = await getArticleFromDom(results[0].dom);
		if (selection && results[0].selection) {
			article.content = results[0].selection;
		}
		return article;
	} else {
		return null;
	}
}

async function formatTitle(article) {
	let options = await getOptions();

	let title = textReplace(options.title, article, options.disallowedChars + "/");
	title = title
		.split("/")
		.map((s) => generateValidFileName(s, options.disallowedChars))
		.join("/");
	return title;
}

async function formatMdClipsFolder(article) {
	let options = await getOptions();

	let mdClipsFolder = "";
	if (options.mdClipsFolder && options.downloadMode == "downloadsApi") {
		mdClipsFolder = textReplace(options.mdClipsFolder, article, options.disallowedChars);
		mdClipsFolder = mdClipsFolder
			.split("/")
			.map((s) => generateValidFileName(s, options.disallowedChars))
			.join("/");
		if (!mdClipsFolder.endsWith("/")) mdClipsFolder += "/";
	}
	return mdClipsFolder;
}

async function formatObsidianFolder(article) {
	let options = await getOptions();

	let obsidianFolder = "";
	if (options.obsidianFolder) {
		obsidianFolder = textReplace(options.obsidianFolder, article, options.disallowedChars);
		obsidianFolder = obsidianFolder
			.split("/")
			.map((s) => generateValidFileName(s, options.disallowedChars))
			.join("/");
		if (!obsidianFolder.endsWith("/")) obsidianFolder += "/";
	}

	return obsidianFolder;
}

async function downloadMarkdownFromContext(info, tab) {
	await ensureScripts(tab.id);
	const article = await getArticleFromContent(tab.id, info.menuItemId == "download-markdown-selection");
	const title = await formatTitle(article);
	const { markdown, imageList } = await convertArticleToMarkdown(article);
	const mdClipsFolder = await formatMdClipsFolder(article);
	await downloadMarkdown(markdown, title, tab.id, imageList, mdClipsFolder);
}

async function copyTabAsMarkdownLink(tab) {
	try {
		await ensureScripts(tab.id);
		const article = await getArticleFromContent(tab.id);
		const title = await formatTitle(article);
		await browser.tabs.executeScript(tab.id, { code: `copyToClipboard("[${title}](${article.baseURI})")` });
	} catch (error) {
		console.error("Failed to copy as markdown link: " + error);
	}
}

async function copyTabAsMarkdownLinkAll(tab) {
	try {
		const options = await getOptions();
		options.frontmatter = options.backmatter = "";
		const tabs = await browser.tabs.query({
			currentWindow: true,
		});

		const links = [];
		for (const tab of tabs) {
			await ensureScripts(tab.id);
			const article = await getArticleFromContent(tab.id);
			const title = await formatTitle(article);
			const link = `${options.bulletListMarker} [${title}](${article.baseURI})`;
			links.push(link);
		}

		const markdown = links.join(`\n`);
		await browser.tabs.executeScript(tab.id, { code: `copyToClipboard(${JSON.stringify(markdown)})` });
	} catch (error) {
		console.error("Failed to copy as markdown link: " + error);
	}
}

async function copySelectedTabAsMarkdownLink(tab) {
	try {
		const options = await getOptions();
		options.frontmatter = options.backmatter = "";
		const tabs = await browser.tabs.query({
			currentWindow: true,
			highlighted: true,
		});

		const links = [];
		for (const tab of tabs) {
			await ensureScripts(tab.id);
			const article = await getArticleFromContent(tab.id);
			const title = await formatTitle(article);
			const link = `${options.bulletListMarker} [${title}](${article.baseURI})`;
			links.push(link);
		}

		const markdown = links.join(`\n`);
		await browser.tabs.executeScript(tab.id, { code: `copyToClipboard(${JSON.stringify(markdown)})` });
	} catch (error) {
		console.error("Failed to copy as markdown link: " + error);
	}
}

async function copyMarkdownFromContext(info, tab) {
	try {
		await ensureScripts(tab.id);

		if (info.menuItemId == "copy-markdown-link") {
			const options = await getOptions();
			options.frontmatter = options.backmatter = "";
			const article = await getArticleFromContent(tab.id, false);
			const { markdown } = turndown(
				`<a href="${info.linkUrl}">${info.linkText || info.selectionText}</a>`,
				{ ...options, downloadImages: false },
				article
			);
			await browser.tabs.executeScript(tab.id, { code: `copyToClipboard(${JSON.stringify(markdown)})` });
		} else if (info.menuItemId == "copy-markdown-image") {
			await browser.tabs.executeScript(tab.id, { code: `copyToClipboard("![](${info.srcUrl})")` });
		} else if (info.menuItemId == "copy-markdown-obsidian") {
			const article = await getArticleFromContent(tab.id, info.menuItemId == "copy-markdown-obsidian");
			const title = article.title;
			const options = await getOptions();
			const obsidianVault = options.obsidianVault;
			const obsidianFolder = await formatObsidianFolder(article);
			const { markdown } = await convertArticleToMarkdown(article, false);
			await browser.tabs.executeScript(tab.id, { code: `copyToClipboard(${JSON.stringify(markdown)})` });
			await chrome.tabs.update({
				url:
					"obsidian://advanced-uri?vault=" +
					obsidianVault +
					"&clipboard=true&mode=new&filepath=" +
					obsidianFolder +
					generateValidFileName(title),
			});
		} else if (info.menuItemId == "copy-markdown-obsall") {
			const article = await getArticleFromContent(tab.id, info.menuItemId == "copy-markdown-obsall");
			const title = article.title;
			const options = await getOptions();
			const obsidianVault = options.obsidianVault;
			const obsidianFolder = await formatObsidianFolder(article);
			const { markdown } = await convertArticleToMarkdown(article, false);
			await browser.tabs.executeScript(tab.id, { code: `copyToClipboard(${JSON.stringify(markdown)})` });
			await browser.tabs.update({
				url:
					"obsidian://advanced-uri?vault=" +
					obsidianVault +
					"&clipboard=true&mode=new&filepath=" +
					obsidianFolder +
					generateValidFileName(title),
			});
		} else {
			const article = await getArticleFromContent(tab.id, info.menuItemId == "copy-markdown-selection");
			const { markdown } = await convertArticleToMarkdown(article, false);
			await browser.tabs.executeScript(tab.id, { code: `copyToClipboard(${JSON.stringify(markdown)})` });
		}
	} catch (error) {
		console.error("Failed to copy text: " + error);
	}
}

async function downloadMarkdownForAllTabs(info) {
	const tabs = await browser.tabs.query({
		currentWindow: true,
	});
	tabs.forEach((tab) => {
		downloadMarkdownFromContext(info, tab);
	});
}

function replaceAll(str, search, replacement) {
	if (Object.prototype.toString.call(search).toLowerCase() === "[object regexp]") {
		return str.replace(search, replacement);
	}

	return str.replace(new RegExp(search, "g"), replacement);
}

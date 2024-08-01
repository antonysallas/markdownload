function Readability(doc, options) {
	if (options?.documentElement) {
		doc = options;
		options = arguments[2];
	} else if (!doc?.documentElement) {
		throw new Error("First argument to Readability constructor should be a document object.");
	}
	options = options || {};

	this._doc = doc;
	this._docJSDOMParser = this._doc.firstChild.__JSDOMParser__;
	this._articleTitle = null;
	this._articleByline = null;
	this._articleDir = null;
	this._articleSiteName = null;
	this._attempts = [];

	this._debug = !!options.debug;
	this._maxElemsToParse = options.maxElemsToParse || this.DEFAULT_MAX_ELEMS_TO_PARSE;
	this._nbTopCandidates = options.nbTopCandidates || this.DEFAULT_N_TOP_CANDIDATES;
	this._charThreshold = options.charThreshold || this.DEFAULT_CHAR_THRESHOLD;
	this._classesToPreserve = this.CLASSES_TO_PRESERVE.concat(options.classesToPreserve || []);
	this._keepClasses = !!options.keepClasses;
	this._serializer =
		options.serializer ||
		function (el) {
			return el.innerHTML;
		};
	this._disableJSONLD = !!options.disableJSONLD;

	this._flags = this.FLAG_STRIP_UNLIKELYS | this.FLAG_WEIGHT_CLASSES | this.FLAG_CLEAN_CONDITIONALLY;

	if (this._debug) {
		let logNode = function (node) {
			if (node.nodeType == node.TEXT_NODE) {
				return `${node.nodeName} ("${node.textContent}")`;
			}
			let attrPairs = Array.from(node.attributes || [], function (attr) {
				return `${attr.name}="${attr.value}"`;
			}).join(" ");
			return `<${node.localName} ${attrPairs}>`;
		};
		this.log = function () {
			if (typeof dump !== "undefined") {
				const msg = Array.prototype.map.call(arguments, (x) => (x?.nodeName ? logNode(x) : x)).join(" ");
				dump?.("Reader: (Readability) " + msg + "\n");
			} else if (typeof console !== "undefined") {
				let args = Array.from(arguments, (arg) => {
					if (arg && arg.nodeType == this.ELEMENT_NODE) {
						return logNode(arg);
					}
					return arg;
				});
				args.unshift("Reader: (Readability)");
				console.log(...args);
			}
		};
	} else {
		this.log = function () {};
	}
}

Readability.prototype = {
	FLAG_STRIP_UNLIKELYS: 0x1,
	FLAG_WEIGHT_CLASSES: 0x2,
	FLAG_CLEAN_CONDITIONALLY: 0x4,

	ELEMENT_NODE: 1,
	TEXT_NODE: 3,

	DEFAULT_MAX_ELEMS_TO_PARSE: 0,

	DEFAULT_N_TOP_CANDIDATES: 5,

	DEFAULT_TAGS_TO_SCORE: "section,h2,h3,h4,h5,h6,p,td,pre".toUpperCase().split(","),

	DEFAULT_CHAR_THRESHOLD: 500,

	REGEXPS: {
		unlikelyCandidates1:
			/ad-|ai2html|banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|footer|gdpr|header|legends/i,
		unlikelyCandidates2: /menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental/i,
		unlikelyCandidates3: /agegate|pagination|pager|popup|yom-remote|ad-break/i,

		okMaybeItsACandidate: /and|article|body|column|content|main|shadow/i,

		positive: /article|body|content|entry|hentry|h-entry|main|page|pagination|post|text|blog|story/i,
		negative1:
			/-ad-|hidden|^hid$| hid$| hid |^hid |banner|combx|comment|com-|contact|foot|footer|footnote|gdpr|masthead|media|meta/i,
		negative2: /outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|tool|widget/i,
		extraneous: /print|archive|comment|discuss|e-?mail|share|reply|all|login|sign|single|utility/i,
		byline: /byline|author|dateline|writtenby|p-author/i,
		replaceFonts: /<(\/?)font[^>]*>/gi,
		normalize: /\s{2,}/g,
		videos:
			/\/\/(www\.)?((dailymotion|youtube|youtube-nocookie|player\.vimeo|v\.qq)\.com|(archive|upload\.wikimedia)\.org|player\.twitch\.tv)/i,
		shareElements: /(\b|_)(share|sharedaddy)(\b|_)/i,
		nextLink: /(next|weiter|continue|>([^|]|$)|»([^|]|$))/i,
		prevLink: /(prev|earl|old|new|<|«)/i,
		tokenize: /\W+/g,
		whitespace: /^\s*$/,
		hasContent: /\S$/,
		hashUrl: /^#.+/,
		srcsetUrl: /(\S+)(\s+[\d.]+[xw])?(\s*(?:,|$))/g,
		b64DataUrl: /^data:\s*([^\s;,]+)\s*;\s*base64\s*,/i,
		jsonLdArticleTypes1:
			/^(Article|AdvertiserContentArticle|NewsArticle|AnalysisNewsArticle|AskPublicNewsArticle|BackgroundNewsArticle)$/,
		jsonLdArticleTypes2:
			/^(OpinionNewsArticle|ReportageNewsArticle|ReviewNewsArticle|Report|SatiricalArticle|ScholarlyArticle)$/,
		jsonLdArticleTypes3:
			/^(MedicalScholarlyArticle|SocialMediaPosting|BlogPosting|LiveBlogPosting|DiscussionForumPosting|TechArticle|APIReference)$/,
	},

	UNLIKELY_ROLES: ["menu", "menubar", "complementary", "navigation", "alert", "alertdialog", "dialog"],

	DIV_TO_P_ELEMS: new Set(["BLOCKQUOTE", "DL", "DIV", "IMG", "OL", "P", "PRE", "TABLE", "UL"]),

	ALTER_TO_DIV_EXCEPTIONS: ["DIV", "ARTICLE", "SECTION", "P"],

	PRESENTATIONAL_ATTRIBUTES: [
		"align",
		"background",
		"bgcolor",
		"border",
		"cellpadding",
		"cellspacing",
		"frame",
		"hspace",
		"rules",
		"style",
		"valign",
		"vspace",
	],

	DEPRECATED_SIZE_ATTRIBUTE_ELEMS: ["TABLE", "TH", "TD", "HR", "PRE"],

	PHRASING_ELEMS: [
		"ABBR",
		"AUDIO",
		"B",
		"BDO",
		"BR",
		"BUTTON",
		"CITE",
		"CODE",
		"DATA",
		"DATALIST",
		"DFN",
		"EM",
		"EMBED",
		"I",
		"IMG",
		"INPUT",
		"KBD",
		"LABEL",
		"MARK",
		"MATH",
		"METER",
		"NOSCRIPT",
		"OBJECT",
		"OUTPUT",
		"PROGRESS",
		"Q",
		"RUBY",
		"SAMP",
		"SCRIPT",
		"SELECT",
		"SMALL",
		"SPAN",
		"STRONG",
		"SUB",
		"SUP",
		"TEXTAREA",
		"TIME",
		"VAR",
		"WBR",
	],

	CLASSES_TO_PRESERVE: ["page"],

	HTML_ESCAPE_MAP: {
		lt: "<",
		gt: ">",
		amp: "&",
		quot: '"',
		apos: "'",
	},

	_postProcessContent: function (articleContent) {
		this._fixRelativeUris(articleContent);

		this._simplifyNestedElements(articleContent);

		if (!this._keepClasses) {
			this._cleanClasses(articleContent);
		}
	},

	_removeNodes: function (nodeList, filterFn) {
		if (this._docJSDOMParser && nodeList._isLiveNodeList) {
			throw new Error("Do not pass live node lists to _removeNodes");
		}
		for (let i = nodeList.length - 1; i >= 0; i--) {
			let node = nodeList[i];
			let parentNode = node.parentNode;
			if (parentNode) {
				if (!filterFn || filterFn.call(this, node, i, nodeList)) {
					parentNode.removeChild(node);
				}
			}
		}
	},

	_replaceNodeTags: function (nodeList, newTagName) {
		if (this._docJSDOMParser && nodeList._isLiveNodeList) {
			throw new Error("Do not pass live node lists to _replaceNodeTags");
		}
		for (const node of nodeList) {
			this._setNodeTag(node, newTagName);
		}
	},

	_forEachNode: function (nodeList, fn) {
		Array.prototype.forEach.call(nodeList, fn, this);
	},

	_findNode: function (nodeList, fn) {
		return Array.prototype.find.call(nodeList, fn, this);
	},

	_someNode: function (nodeList, fn) {
		return Array.prototype.some.call(nodeList, fn, this);
	},

	_everyNode: function (nodeList, fn) {
		return Array.prototype.every.call(nodeList, fn, this);
	},

	_concatNodeLists: function () {
		let slice = Array.prototype.slice;
		let args = slice.call(arguments);
		let nodeLists = args.map(function (list) {
			return slice.call(list);
		});
		return Array.prototype.concat.apply([], nodeLists);
	},

	_getAllNodesWithTag: function (node, tagNames) {
		if (node.querySelectorAll) {
			return node.querySelectorAll(tagNames.join(","));
		}
		return [].concat(
			...tagNames.map(function (tag) {
				let collection = node.getElementsByTagName(tag);
				return Array.isArray(collection) ? collection : Array.from(collection);
			})
		);
	},

	_cleanClasses: function (node) {
		let classesToPreserve = this._classesToPreserve;
		let className = (node.getAttribute("class") || "")
			.split(/\s+/)
			.filter(function (cls) {
				return classesToPreserve.indexOf(cls) != -1;
			})
			.join(" ");

		if (className) {
			node.setAttribute("class", className);
		} else {
			node.removeAttribute("class");
		}

		for (node = node.firstElementChild; node; node = node.nextElementSibling) {
			this._cleanClasses(node);
		}
	},

	_fixRelativeUris: function (articleContent) {
		let baseURI = this._doc.baseURI;
		let documentURI = this._doc.documentURI;
		function toAbsoluteURI(uri) {
			if (baseURI == documentURI && uri.charAt(0) == "#") {
				return uri;
			}

			try {
				return new URL(uri, baseURI).href;
			} catch (ex) {}
			return uri;
		}

		let links = this._getAllNodesWithTag(articleContent, ["a"]);
		this._forEachNode(links, function (link) {
			let href = link.getAttribute("href");
			if (href) {
				if (href.indexOf("javascript:") === 0) {
					if (link.childNodes.length === 1 && link.childNodes[0].nodeType === this.TEXT_NODE) {
						let text = this._doc.createTextNode(link.textContent);
						link.parentNode.replaceChild(text, link);
					} else {
						let container = this._doc.createElement("span");
						while (link.firstChild) {
							container.appendChild(link.firstChild);
						}
						link.parentNode.replaceChild(container, link);
					}
				} else {
					link.setAttribute("href", toAbsoluteURI(href));
				}
			}
		});

		let medias = this._getAllNodesWithTag(articleContent, ["img", "picture", "figure", "video", "audio", "source"]);

		this._forEachNode(medias, function (media) {
			let src = media.getAttribute("src");
			let poster = media.getAttribute("poster");
			let srcset = media.getAttribute("srcset");

			if (src) {
				media.setAttribute("src", toAbsoluteURI(src));
			}

			if (poster) {
				media.setAttribute("poster", toAbsoluteURI(poster));
			}

			if (srcset) {
				let newSrcset = srcset.replace(this.REGEXPS.srcsetUrl, function (_, p1, p2, p3) {
					return toAbsoluteURI(p1) + (p2 || "") + p3;
				});

				media.setAttribute("srcset", newSrcset);
			}
		});
	},

	_simplifyNestedElements: function (articleContent) {
		let node = articleContent;

		while (node) {
			if (node.parentNode && ["DIV", "SECTION"].includes(node.tagName) && !node.id?.startsWith("readability")) {
				if (this._isElementWithoutContent(node)) {
					node = this._removeAndGetNext(node);
					continue;
				} else if (this._hasSingleTagInsideElement(node, "DIV") || this._hasSingleTagInsideElement(node, "SECTION")) {
					let child = node.children[0];
					for (const attr of node.attributes) {
						child.setAttribute(attr.name, attr.value);
					}
					node.parentNode.replaceChild(child, node);
					node = child;
					continue;
				}
			}

			node = this._getNextNode(node);
		}
	},

	_getArticleTitle: function () {
		let doc = this._doc;
		let curTitle = "";
		let origTitle = "";

		try {
			curTitle = origTitle = doc.title.trim();

			if (typeof curTitle !== "string") curTitle = origTitle = this._getInnerText(doc.getElementsByTagName("title")[0]);
		} catch (e) {}

		let titleHadHierarchicalSeparators = false;
		const wordCount = (str) => str.split(/\s+/).length;

		const hasHierarchicalSeparators = (str) => / [|/>»] /.test(str);

		const refineTitleBySeparators = (title) => {
			let refinedTitle = title.replace(/(.*)[|/>»] .*/gi, "$1");
			if (wordCount(refinedTitle) < 3) refinedTitle = title.replace(/[^|/>»]*[|/>»](.*)/gi, "$1");
			return refinedTitle;
		};

		const refineTitleByColon = (title, headings) => {
			let refinedTitle = title.substring(title.lastIndexOf(":") + 1);
			if (wordCount(refinedTitle) < 3) refinedTitle = title.substring(title.indexOf(":") + 1);
			else if (wordCount(title.substr(0, title.indexOf(":"))) > 5) refinedTitle = title;
			return refinedTitle;
		};

		if (hasHierarchicalSeparators(curTitle)) {
			titleHadHierarchicalSeparators = hasHierarchicalSeparators(curTitle);
			curTitle = refineTitleBySeparators(origTitle);
		} else if (curTitle.includes(": ")) {
			let headings = this._concatNodeLists(doc.getElementsByTagName("h1"), doc.getElementsByTagName("h2"));
			let match = this._someNode(headings, (heading) => heading.textContent.trim() === curTitle.trim());
			if (!match) curTitle = refineTitleByColon(origTitle, headings);
		} else if (curTitle.length > 150 || curTitle.length < 15) {
			let hOnes = doc.getElementsByTagName("h1");
			if (hOnes.length === 1) curTitle = this._getInnerText(hOnes[0]);
		}

		curTitle = curTitle.trim().replace(this.REGEXPS.normalize, " ");
		let curTitleWordCount = wordCount(curTitle);
		if (
			curTitleWordCount <= 4 &&
			(!titleHadHierarchicalSeparators || curTitleWordCount != wordCount(origTitle.replace(/[|\-/>»]+/g, "")) - 1)
		) {
			curTitle = origTitle;
		}

		return curTitle;
	},

	_prepDocument: function () {
		let doc = this._doc;

		this._removeNodes(this._getAllNodesWithTag(doc, ["style"]));

		if (doc.body) {
			this._replaceBrs(doc.body);
		}

		this._replaceNodeTags(this._getAllNodesWithTag(doc, ["font"]), "SPAN");
	},

	_nextNode: function (node) {
		let next = node;
		while (next && next.nodeType != this.ELEMENT_NODE && this.REGEXPS.whitespace.test(next.textContent)) {
			next = next.nextSibling;
		}
		return next;
	},

	_replaceBrs: function (elem) {
		const replaceBrElements = (br) => {
			let next = br.nextSibling;
			let replaced = false;

			const removeNextBrs = () => {
				while (next && next.tagName === "BR") {
					replaced = true;
					let brSibling = next.nextSibling;
					next.parentNode.removeChild(next);
					next = brSibling;
					next = this._nextNode(next);
				}
			};

			const createParagraphAndMoveContent = () => {
				if (replaced) {
					let p = this._doc.createElement("p");
					br.parentNode.replaceChild(p, br);
					moveContentToParagraph(p);
					cleanUpParagraph(p);
				}
			};

			const moveContentToParagraph = (p) => {
				next = p.nextSibling;
				while (next) {
					if (isEndOfParagraph(next)) break;
					if (!this._isPhrasingContent(next)) break;
					let sibling = next.nextSibling;
					p.appendChild(next);
					next = sibling;
				}
			};

			const isEndOfParagraph = (node) => {
				if (node.tagName === "BR") {
					let nextElem = this._nextNode(node.nextSibling);
					return nextElem && nextElem.tagName === "BR";
				}
				return false;
			};

			const cleanUpParagraph = (p) => {
				while (p.lastChild && this._isWhitespace(p.lastChild)) {
					p.removeChild(p.lastChild);
				}
				if (p.parentNode.tagName === "P") this._setNodeTag(p.parentNode, "DIV");
			};

			removeNextBrs();
			createParagraphAndMoveContent();
		};

		this._forEachNode(this._getAllNodesWithTag(elem, ["br"]), replaceBrElements);
	},

	_setNodeTag: function (node, tag) {
		this.log("_setNodeTag", node, tag);
		if (this._docJSDOMParser) {
			node.localName = tag.toLowerCase();
			node.tagName = tag.toUpperCase();
			return node;
		}

		let replacement = node.ownerDocument.createElement(tag);
		while (node.firstChild) {
			replacement.appendChild(node.firstChild);
		}
		node.parentNode.replaceChild(replacement, node);
		if (node.readability) replacement.readability = node.readability;

		for (const attr of node.attributes) {
			try {
				replacement.setAttribute(attr.name, attr.value);
			} catch (ex) {
				// handle exception
			}
		}
		return replacement;
	},

	_prepArticle: function (articleContent) {
		this._cleanStyles(articleContent);

		this._markDataTables(articleContent);

		this._fixLazyImages(articleContent);

		this._cleanConditionally(articleContent, "form");
		this._cleanConditionally(articleContent, "fieldset");
		this._clean(articleContent, "object");
		this._clean(articleContent, "embed");
		this._clean(articleContent, "footer");
		this._clean(articleContent, "link");
		this._clean(articleContent, "aside");

		let shareElementThreshold = this.DEFAULT_CHAR_THRESHOLD;

		this._forEachNode(articleContent.children, function (topCandidate) {
			this._cleanMatchedNodes(topCandidate, function (node, matchString) {
				return this.REGEXPS.shareElements.test(matchString) && node.textContent.length < shareElementThreshold;
			});
		});

		this._clean(articleContent, "iframe");
		this._clean(articleContent, "input");
		this._clean(articleContent, "textarea");
		this._clean(articleContent, "select");
		this._clean(articleContent, "button");
		this._cleanHeaders(articleContent);

		this._cleanConditionally(articleContent, "table");
		this._cleanConditionally(articleContent, "ul");
		this._cleanConditionally(articleContent, "div");

		this._replaceNodeTags(this._getAllNodesWithTag(articleContent, ["h1"]), "h2");

		this._removeNodes(this._getAllNodesWithTag(articleContent, ["p"]), function (paragraph) {
			let imgCount = paragraph.getElementsByTagName("img").length;
			let embedCount = paragraph.getElementsByTagName("embed").length;
			let objectCount = paragraph.getElementsByTagName("object").length;
			let iframeCount = paragraph.getElementsByTagName("iframe").length;
			let totalCount = imgCount + embedCount + objectCount + iframeCount;

			return totalCount === 0 && !this._getInnerText(paragraph, false);
		});

		this._forEachNode(this._getAllNodesWithTag(articleContent, ["br"]), function (br) {
			let next = this._nextNode(br.nextSibling);
			if (next && next.tagName == "P") br.parentNode.removeChild(br);
		});

		this._forEachNode(this._getAllNodesWithTag(articleContent, ["table"]), function (table) {
			let tbody = this._hasSingleTagInsideElement(table, "TBODY") ? table.firstElementChild : table;
			if (this._hasSingleTagInsideElement(tbody, "TR")) {
				let row = tbody.firstElementChild;
				if (this._hasSingleTagInsideElement(row, "TD")) {
					let cell = row.firstElementChild;
					cell = this._setNodeTag(cell, this._everyNode(cell.childNodes, this._isPhrasingContent) ? "P" : "DIV");
					table.parentNode.replaceChild(cell, table);
				}
			}
		});
	},

	_initializeNode: function (node) {
		node.readability = { contentScore: 0 };

		switch (node.tagName) {
			case "DIV":
				node.readability.contentScore += 5;
				break;

			case "PRE":
			case "TD":
			case "BLOCKQUOTE":
				node.readability.contentScore += 3;
				break;

			case "ADDRESS":
			case "OL":
			case "UL":
			case "DL":
			case "DD":
			case "DT":
			case "LI":
			case "FORM":
				node.readability.contentScore -= 3;
				break;

			case "H1":
			case "H2":
			case "H3":
			case "H4":
			case "H5":
			case "H6":
			case "TH":
				node.readability.contentScore -= 5;
				break;
		}

		node.readability.contentScore += this._getClassWeight(node);
	},

	_removeAndGetNext: function (node) {
		let nextNode = this._getNextNode(node, true);
		node.parentNode.removeChild(node);
		return nextNode;
	},

	_getNextNode: function (node, ignoreSelfAndKids) {
		if (!ignoreSelfAndKids && node.firstElementChild) {
			return node.firstElementChild;
		}
		if (node.nextElementSibling) {
			return node.nextElementSibling;
		}
		do {
			node = node.parentNode;
		} while (node?.nextElementSibling === undefined);
		return node?.nextElementSibling ?? null;
	},

	_textSimilarity: function (textA, textB) {
		let tokensA = textA.toLowerCase().split(this.REGEXPS.tokenize).filter(Boolean);
		let tokensB = textB.toLowerCase().split(this.REGEXPS.tokenize).filter(Boolean);
		if (!tokensA.length || !tokensB.length) {
			return 0;
		}
		let uniqTokensB = tokensB.filter((token) => !tokensA.includes(token));
		let distanceB = uniqTokensB.join(" ").length / tokensB.join(" ").length;
		return 1 - distanceB;
	},

	_checkByline: function (node, matchString) {
		if (this._articleByline) {
			return false;
		}

		if (node.getAttribute !== undefined) {
			const rel = node.getAttribute("rel");
			const itemprop = node.getAttribute("itemprop");

			if (
				(rel === "author" ||
					(itemprop && itemprop.indexOf("author") !== -1) ||
					this.REGEXPS.byline.test(matchString)) &&
				this._isValidByline(node.textContent)
			) {
				this._articleByline = node.textContent.trim();
				return true;
			}
		}

		return false;
	},

	_getNodeAncestors: function (node, maxDepth) {
		maxDepth = maxDepth || 0;
		let i = 0,
			ancestors = [];
		while (node.parentNode) {
			ancestors.push(node.parentNode);
			if (maxDepth && ++i === maxDepth) break;
			node = node.parentNode;
		}
		return ancestors;
	},

	_grabArticle: function (page) {
		this.log("**** grabArticle ****");
		let doc = this._doc;
		let isPaging = page !== null;
		page = page || this._doc.body;

		if (!page) {
			this.log("No body found in document. Abort.");
			return null;
		}

		let pageCacheHtml = page.innerHTML;

		while (true) {
			this.log("Starting grabArticle loop");
			let stripUnlikelyCandidates = this._flagIsActive(this.FLAG_STRIP_UNLIKELYS);

			let elementsToScore = [];
			let node = this._doc.documentElement;

			let shouldRemoveTitleHeader = true;

			while (node) {
				if (node.tagName === "HTML") {
					this._articleLang = node.getAttribute("lang");
				}

				let matchString = node.className + " " + node.id;

				if (!this._isProbablyVisible(node)) {
					this.log("Removing hidden node - " + matchString);
					node = this._removeAndGetNext(node);
					continue;
				}

				if (this._checkByline(node, matchString)) {
					node = this._removeAndGetNext(node);
					continue;
				}

				if (shouldRemoveTitleHeader && this._headerDuplicatesTitle(node)) {
					this.log("Removing header: ", node.textContent.trim(), this._articleTitle.trim());
					shouldRemoveTitleHeader = false;
					node = this._removeAndGetNext(node);
					continue;
				}

				if (stripUnlikelyCandidates) {
					if (
						this.REGEXPS.unlikelyCandidates1.test(matchString) &&
						this.REGEXPS.unlikelyCandidates2.test(matchString) &&
						this.REGEXPS.unlikelyCandidates3.test(matchString) &&
						!this.REGEXPS.okMaybeItsACandidate.test(matchString) &&
						!this._hasAncestorTag(node, "table") &&
						!this._hasAncestorTag(node, "code") &&
						node.tagName !== "BODY" &&
						node.tagName !== "A"
					) {
						this.log("Removing unlikely candidate - " + matchString);
						node = this._removeAndGetNext(node);
						continue;
					}

					if (this.UNLIKELY_ROLES.includes(node.getAttribute("role"))) {
						this.log("Removing content with role " + node.getAttribute("role") + " - " + matchString);
						node = this._removeAndGetNext(node);
						continue;
					}
				}

				if (
					(node.tagName === "DIV" ||
						node.tagName === "SECTION" ||
						node.tagName === "HEADER" ||
						node.tagName === "H1" ||
						node.tagName === "H2" ||
						node.tagName === "H3" ||
						node.tagName === "H4" ||
						node.tagName === "H5" ||
						node.tagName === "H6") &&
					this._isElementWithoutContent(node)
				) {
					node = this._removeAndGetNext(node);
					continue;
				}

				if (this.DEFAULT_TAGS_TO_SCORE.indexOf(node.tagName) !== -1) {
					elementsToScore.push(node);
				}

				if (node.tagName === "DIV") {
					let p = null;
					let childNode = node.firstChild;
					while (childNode) {
						let nextSibling = childNode.nextSibling;
						if (this._isPhrasingContent(childNode)) {
							if (p !== null) {
								p.appendChild(childNode);
							} else if (!this._isWhitespace(childNode)) {
								p = doc.createElement("p");
								node.replaceChild(p, childNode);
								p.appendChild(childNode);
							}
						} else if (p !== null) {
							while (p.lastChild && this._isWhitespace(p.lastChild)) {
								p.removeChild(p.lastChild);
							}
							p = null;
						}
						childNode = nextSibling;
					}

					if (this._hasSingleTagInsideElement(node, "P") && this._getLinkDensity(node) < 0.25) {
						let newNode = node.children[0];
						node.parentNode.replaceChild(newNode, node);
						node = newNode;
						elementsToScore.push(node);
					} else if (!this._hasChildBlockElement(node)) {
						node = this._setNodeTag(node, "P");
						elementsToScore.push(node);
					}
				}
				node = this._getNextNode(node);
			}

			let candidates = [];
			this._forEachNode(elementsToScore, function (elementToScore) {
				if (!elementToScore.parentNode || typeof elementToScore.parentNode.tagName === "undefined") return;

				let innerText = this._getInnerText(elementToScore);
				if (innerText.length < 25) return;

				let ancestors = this._getNodeAncestors(elementToScore, 5);
				if (ancestors.length === 0) return;

				let contentScore = 0;

				contentScore += 1;

				contentScore += innerText.split(",").length;

				contentScore += Math.min(Math.floor(innerText.length / 100), 3);

				this._forEachNode(ancestors, function (ancestor, level) {
					if (!ancestor.tagName || !ancestor.parentNode || typeof ancestor.parentNode.tagName === "undefined") return;

					if (typeof ancestor.readability === "undefined") {
						this._initializeNode(ancestor);
						candidates.push(ancestor);
					}

					let scoreDivider;
					if (level === 0) scoreDivider = 1;
					else if (level === 1) scoreDivider = 2;
					else scoreDivider = level * 3;

					ancestor.readability.contentScore += contentScore / scoreDivider;
				});
			});

			let topCandidates = [];
			for (let c = 0, cl = candidates.length; c < cl; c += 1) {
				let candidate = candidates[c];

				let candidateScore = candidate.readability.contentScore * (1 - this._getLinkDensity(candidate));
				candidate.readability.contentScore = candidateScore;

				this.log("Candidate:", candidate, "with score " + candidateScore);

				for (let t = 0; t < this._nbTopCandidates; t++) {
					let aTopCandidate = topCandidates[t];

					if (!aTopCandidate || candidateScore > aTopCandidate.readability.contentScore) {
						topCandidates.splice(t, 0, candidate);
						if (topCandidates.length > this._nbTopCandidates) topCandidates.pop();
						break;
					}
				}
			}

			let topCandidate = topCandidates[0] || null;
			let neededToCreateTopCandidate = false;
			let parentOfTopCandidate;

			if (topCandidate === null || topCandidate.tagName === "BODY") {
				topCandidate = doc.createElement("DIV");
				neededToCreateTopCandidate = true;
				while (page.firstChild) {
					this.log("Moving child out:", page.firstChild);
					topCandidate.appendChild(page.firstChild);
				}

				page.appendChild(topCandidate);

				this._initializeNode(topCandidate);
			} else if (topCandidate) {
				let alternativeCandidateAncestors = [];
				for (let i = 1; i < topCandidates.length; i++) {
					if (topCandidates[i].readability.contentScore / topCandidate.readability.contentScore >= 0.75) {
						alternativeCandidateAncestors.push(this._getNodeAncestors(topCandidates[i]));
					}
				}
				let MINIMUM_TOPCANDIDATES = 3;
				if (alternativeCandidateAncestors.length >= MINIMUM_TOPCANDIDATES) {
					parentOfTopCandidate = topCandidate.parentNode;
					while (parentOfTopCandidate.tagName !== "BODY") {
						let listsContainingThisAncestor = 0;
						for (
							let ancestorIndex = 0;
							ancestorIndex < alternativeCandidateAncestors.length &&
							listsContainingThisAncestor < MINIMUM_TOPCANDIDATES;
							ancestorIndex++
						) {
							listsContainingThisAncestor += Number(
								alternativeCandidateAncestors[ancestorIndex].includes(parentOfTopCandidate)
							);
						}
						if (listsContainingThisAncestor >= MINIMUM_TOPCANDIDATES) {
							topCandidate = parentOfTopCandidate;
							break;
						}
						parentOfTopCandidate = parentOfTopCandidate.parentNode;
					}
				}
				if (!topCandidate.readability) {
					this._initializeNode(topCandidate);
				}

				parentOfTopCandidate = topCandidate.parentNode;
				let lastScore = topCandidate.readability.contentScore;
				let scoreThreshold = lastScore / 3;
				while (parentOfTopCandidate.tagName !== "BODY") {
					if (!parentOfTopCandidate.readability) {
						parentOfTopCandidate = parentOfTopCandidate.parentNode;
						continue;
					}
					let parentScore = parentOfTopCandidate.readability.contentScore;
					if (parentScore < scoreThreshold) break;
					if (parentScore > lastScore) {
						topCandidate = parentOfTopCandidate;
						break;
					}
					lastScore = parentOfTopCandidate.readability.contentScore;
					parentOfTopCandidate = parentOfTopCandidate.parentNode;
				}

				parentOfTopCandidate = topCandidate.parentNode;
				while (parentOfTopCandidate.tagName != "BODY" && parentOfTopCandidate.children.length == 1) {
					topCandidate = parentOfTopCandidate;
					parentOfTopCandidate = topCandidate.parentNode;
				}
				if (!topCandidate.readability) {
					this._initializeNode(topCandidate);
				}
			}

			let articleContent = doc.createElement("DIV");
			if (isPaging) articleContent.id = "readability-content";

			let siblingScoreThreshold = Math.max(10, topCandidate.readability.contentScore * 0.2);
			parentOfTopCandidate = topCandidate.parentNode;
			let siblings = parentOfTopCandidate.children;

			for (let s = 0, sl = siblings.length; s < sl; s++) {
				let sibling = siblings[s];
				let append = false;

				this.log(
					"Looking at sibling node:",
					sibling,
					sibling.readability ? "with score " + sibling.readability.contentScore : ""
				);
				this.log("Sibling has score", sibling.readability ? sibling.readability.contentScore : "Unknown");

				if (sibling === topCandidate) {
					append = true;
				} else {
					let contentBonus = 0;

					if (sibling.className === topCandidate.className && topCandidate.className !== "")
						contentBonus += topCandidate.readability.contentScore * 0.2;

					if (sibling.readability && sibling.readability.contentScore + contentBonus >= siblingScoreThreshold) {
						append = true;
					} else if (sibling.nodeName === "P") {
						let linkDensity = this._getLinkDensity(sibling);
						let nodeContent = this._getInnerText(sibling);
						let nodeLength = nodeContent.length;

						if (
							(nodeLength > 80 && linkDensity < 0.25) ||
							(nodeLength < 80 && nodeLength > 0 && linkDensity === 0 && nodeContent.search(/\.( |$)/) !== -1)
						) {
							append = true;
						}
					}
				}

				if (append) {
					this.log("Appending node:", sibling);

					if (this.ALTER_TO_DIV_EXCEPTIONS.indexOf(sibling.nodeName) === -1) {
						this.log("Altering sibling:", sibling, "to div.");

						sibling = this._setNodeTag(sibling, "DIV");
					}

					articleContent.appendChild(sibling);
					siblings = parentOfTopCandidate.children;
					sl -= 1;
				}
			}

			if (this._debug) this.log("Article content pre-prep: " + articleContent.innerHTML);
			this._prepArticle(articleContent);
			if (this._debug) this.log("Article content post-prep: " + articleContent.innerHTML);

			if (neededToCreateTopCandidate) {
				topCandidate.id = "readability-page-1";
				topCandidate.className = "page";
			} else {
				let div = doc.createElement("DIV");
				div.id = "readability-page-1";
				div.className = "page";
				while (articleContent.firstChild) {
					div.appendChild(articleContent.firstChild);
				}
				articleContent.appendChild(div);
			}

			if (this._debug) this.log("Article content after paging: " + articleContent.innerHTML);

			let parseSuccessful = true;

			let textLength = this._getInnerText(articleContent, true).length;
			if (textLength < this._charThreshold) {
				parseSuccessful = false;
				page.innerHTML = pageCacheHtml;

				if (this._flagIsActive(this.FLAG_STRIP_UNLIKELYS)) {
					this._removeFlag(this.FLAG_STRIP_UNLIKELYS);
					this._attempts.push({ articleContent: articleContent, textLength: textLength });
				} else if (this._flagIsActive(this.FLAG_WEIGHT_CLASSES)) {
					this._removeFlag(this.FLAG_WEIGHT_CLASSES);
					this._attempts.push({ articleContent: articleContent, textLength: textLength });
				} else if (this._flagIsActive(this.FLAG_CLEAN_CONDITIONALLY)) {
					this._removeFlag(this.FLAG_CLEAN_CONDITIONALLY);
					this._attempts.push({ articleContent: articleContent, textLength: textLength });
				} else {
					this._attempts.push({ articleContent: articleContent, textLength: textLength });
					this._attempts.sort(function (a, b) {
						return b.textLength - a.textLength;
					});

					if (!this._attempts[0].textLength) {
						return null;
					}

					articleContent = this._attempts[0].articleContent;
					parseSuccessful = true;
				}
			}

			if (parseSuccessful) {
				let ancestors = [parentOfTopCandidate, topCandidate].concat(this._getNodeAncestors(parentOfTopCandidate));
				this._someNode(ancestors, function (ancestor) {
					if (!ancestor.tagName) return false;
					let articleDir = ancestor.getAttribute("dir");
					if (articleDir) {
						this._articleDir = articleDir;
						return true;
					}
					return false;
				});
				return articleContent;
			}
		}
	},

	_isValidByline: function (byline) {
		if (typeof byline == "string" || byline instanceof String) {
			byline = byline.trim();
			return byline.length > 0 && byline.length < 100;
		}
		return false;
	},

	_unescapeHtmlEntities: function (str) {
		if (!str) {
			return str;
		}

		let htmlEscapeMap = this.HTML_ESCAPE_MAP;
		return str
			.replace(/&(quot|amp|apos|lt|gt);/g, function (_, tag) {
				return htmlEscapeMap[tag];
			})
			.replace(/&#(?:x([\da-z]{1,4})|(\d{1,4}));/gi, function (_, hex, numStr) {
				let num = parseInt(hex || numStr, hex ? 16 : 10);
				return String.fromCharCode(num);
			});
	},

	_getJSONLD: function (doc) {
		const scripts = this._getAllNodesWithTag(doc, ["script"]);
		let metadata;

		this._forEachNode(scripts, (jsonLdElement) => {
			if (metadata || jsonLdElement.getAttribute("type") !== "application/ld+json") {
				return;
			}

			try {
				const content = jsonLdElement.textContent.replace(/^\s*(<!\[CDATA\[|\]\]>)\s*$/g, "");
				let parsed = JSON.parse(content);

				if (!parsed?.["@context"]?.match(/^https?:\/\/schema\.org$/)) {
					return;
				}

				// Check if parsed["@type"] is present in any of the new regex patterns
				if (!parsed["@type"] && Array.isArray(parsed["@graph"])) {
					parsed = parsed["@graph"].find(
						(it) =>
							(it["@type"] || "").match(this.REGEXPS.jsonLdArticleTypes1) ||
							(it["@type"] || "").match(this.REGEXPS.jsonLdArticleTypes2) ||
							(it["@type"] || "").match(this.REGEXPS.jsonLdArticleTypes3)
					);
				}

				if (
					!parsed?.["@type"]?.match(this.REGEXPS.jsonLdArticleTypes1) &&
					!parsed?.["@type"]?.match(this.REGEXPS.jsonLdArticleTypes2) &&
					!parsed?.["@type"]?.match(this.REGEXPS.jsonLdArticleTypes3)
				) {
					return;
				}

				metadata = this._extractMetadata(parsed);
			} catch (err) {
				this.log(err.message);
			}
		});

		return metadata || {};
	},

	_extractMetadata: function (parsed) {
		const metadata = {};

		if (typeof parsed.name === "string" && typeof parsed.headline === "string" && parsed.name !== parsed.headline) {
			const title = this._getArticleTitle();
			const nameMatches = this._textSimilarity(parsed.name, title) > 0.75;
			const headlineMatches = this._textSimilarity(parsed.headline, title) > 0.75;

			metadata.title = headlineMatches && !nameMatches ? parsed.headline : parsed.name;
		} else if (typeof parsed.name === "string") {
			metadata.title = parsed.name.trim();
		} else if (typeof parsed.headline === "string") {
			metadata.title = parsed.headline.trim();
		}

		if (parsed.author) {
			if (typeof parsed.author.name === "string") {
				metadata.byline = parsed.author.name.trim();
			} else if (Array.isArray(parsed.author) && parsed.author[0] && typeof parsed.author[0].name === "string") {
				metadata.byline = parsed.author
					.filter((author) => author && typeof author.name === "string")
					.map((author) => author.name.trim())
					.join(", ");
			}
		}

		if (typeof parsed.description === "string") {
			metadata.excerpt = parsed.description.trim();
		}

		if (parsed.publisher && typeof parsed.publisher.name === "string") {
			metadata.siteName = parsed.publisher.name.trim();
		}

		return metadata;
	},

	_getArticleMetadata: function (jsonld) {
		let metadata = {};
		let values = {};
		let metaElements = this._doc.getElementsByTagName("meta");

		let propertyPattern = /\s*(dc|dcterm|og|twitter)\s*:\s*(author|creator|description|title|site_name)\s*/gi;

		let namePattern =
			/^\s*(?:(dc|dcterm|og|twitter|weibo:(article|webpage))\s*[.:]\s*)?(author|creator|description|title|site_name)\s*$/i;

		this._forEachNode(metaElements, function (element) {
			let elementName = element.getAttribute("name");
			let elementProperty = element.getAttribute("property");
			let content = element.getAttribute("content");
			if (!content) {
				return;
			}
			let matches = null;
			let name = null;

			if (elementProperty) {
				matches = elementProperty.match(propertyPattern);
				if (matches) {
					name = matches[0].toLowerCase().replace(/\s/g, "");
					values[name] = content.trim();
				}
			}
			if (!matches && elementName && namePattern.test(elementName)) {
				name = elementName;
				if (content) {
					name = name.toLowerCase().replace(/\s/g, "").replace(/\./g, ":");
					values[name] = content.trim();
				}
			}
		});

		metadata.title =
			jsonld.title ||
			values["dc:title"] ||
			values["dcterm:title"] ||
			values["og:title"] ||
			values["weibo:article:title"] ||
			values["weibo:webpage:title"] ||
			values["title"] ||
			values["twitter:title"];

		if (!metadata.title) {
			metadata.title = this._getArticleTitle();
		}

		metadata.byline = jsonld.byline || values["dc:creator"] || values["dcterm:creator"] || values["author"];

		metadata.excerpt =
			jsonld.excerpt ||
			values["dc:description"] ||
			values["dcterm:description"] ||
			values["og:description"] ||
			values["weibo:article:description"] ||
			values["weibo:webpage:description"] ||
			values["description"] ||
			values["twitter:description"];

		metadata.siteName = jsonld.siteName || values["og:site_name"];

		metadata.title = this._unescapeHtmlEntities(metadata.title);
		metadata.byline = this._unescapeHtmlEntities(metadata.byline);
		metadata.excerpt = this._unescapeHtmlEntities(metadata.excerpt);
		metadata.siteName = this._unescapeHtmlEntities(metadata.siteName);

		return metadata;
	},

	_isSingleImage: function (node) {
		if (node.tagName === "IMG") {
			return true;
		}

		if (node.children.length !== 1 || node.textContent.trim() !== "") {
			return false;
		}

		return this._isSingleImage(node.children[0]);
	},

	_unwrapNoscriptImages: function (doc) {
		let imgs = Array.from(doc.getElementsByTagName("img"));
		this._forEachNode(imgs, function (img) {
			for (let attr of img.attributes) {
				switch (attr.name) {
					case "src":
					case "srcset":
					case "data-src":
					case "data-srcset":
						return;
				}

				if (/\.(jpg|jpeg|png|webp)/i.test(attr.value)) {
					return;
				}
			}

			img.parentNode.removeChild(img);
		});

		let noscripts = Array.from(doc.getElementsByTagName("noscript"));
		const processNoscript = (noscript, doc) => {
			const tmp = doc.createElement("div");
			tmp.innerHTML = noscript.innerHTML;
			if (!this._isSingleImage(tmp)) {
				return;
			}

			const prevElement = noscript.previousElementSibling;
			if (prevElement && this._isSingleImage(prevElement)) {
				let prevImg = prevElement;
				if (prevImg.tagName !== "IMG") {
					prevImg = prevElement.getElementsByTagName("img")[0];
				}

				const newImg = tmp.getElementsByTagName("img")[0];
				updateImageAttributes(prevImg, newImg);

				noscript.parentNode.replaceChild(tmp.firstElementChild, prevElement);
			}
		};

		const updateImageAttributes = (prevImg, newImg) => {
			for (const attr of prevImg.attributes) {
				if (attr.value === "") {
					continue;
				}

				if (attr.name === "src" || attr.name === "srcset" || /\.(jpg|jpeg|png|webp)/i.test(attr.value)) {
					if (newImg.getAttribute(attr.name) === attr.value) {
						continue;
					}

					let attrName = attr.name;
					if (newImg.hasAttribute(attrName)) {
						attrName = "data-old-" + attrName;
					}

					newImg.setAttribute(attrName, attr.value);
				}
			}
		};

		this._forEachNode(noscripts, (noscript) => processNoscript(noscript, doc));
	},

	_removeScripts: function (doc) {
		this._removeNodes(this._getAllNodesWithTag(doc, ["script"]), function (scriptNode) {
			scriptNode.nodeValue = "";
			scriptNode.removeAttribute("src");
			return true;
		});
		this._removeNodes(this._getAllNodesWithTag(doc, ["noscript"]));
	},

	_hasSingleTagInsideElement: function (element, tag) {
		if (element.children.length != 1 || element.children[0].tagName !== tag) {
			return false;
		}

		return !this._someNode(element.childNodes, function (node) {
			return node.nodeType === this.TEXT_NODE && this.REGEXPS.hasContent.test(node.textContent);
		});
	},

	_isElementWithoutContent: function (node) {
		return (
			node.nodeType === this.ELEMENT_NODE &&
			node.textContent.trim().length == 0 &&
			(node.children.length == 0 ||
				node.children.length == node.getElementsByTagName("br").length + node.getElementsByTagName("hr").length)
		);
	},

	_hasChildBlockElement: function (element) {
		return this._someNode(element.childNodes, function (node) {
			return this.DIV_TO_P_ELEMS.has(node.tagName) || this._hasChildBlockElement(node);
		});
	},

	_isPhrasingContent: function (node) {
		return (
			node.nodeType === this.TEXT_NODE ||
			this.PHRASING_ELEMS.indexOf(node.tagName) !== -1 ||
			((node.tagName === "A" || node.tagName === "DEL" || node.tagName === "INS") &&
				this._everyNode(node.childNodes, this._isPhrasingContent))
		);
	},

	_isWhitespace: function (node) {
		return (
			(node.nodeType === this.TEXT_NODE && node.textContent.trim().length === 0) ||
			(node.nodeType === this.ELEMENT_NODE && node.tagName === "BR")
		);
	},

	_getInnerText: function (e, normalizeSpaces) {
		normalizeSpaces = typeof normalizeSpaces === "undefined" ? true : normalizeSpaces;
		let textContent = e.textContent.trim();

		if (normalizeSpaces) {
			return textContent.replace(this.REGEXPS.normalize, " ");
		}
		return textContent;
	},

	_getCharCount: function (e, s) {
		s = s || ",";
		return this._getInnerText(e).split(s).length - 1;
	},

	_cleanStyles: function (e) {
		if (!e || e.tagName.toLowerCase() === "svg") return;

		for (const attr of this.PRESENTATIONAL_ATTRIBUTES) {
			e.removeAttribute(attr);
		}

		if (this.DEPRECATED_SIZE_ATTRIBUTE_ELEMS.indexOf(e.tagName) !== -1) {
			e.removeAttribute("width");
			e.removeAttribute("height");
		}

		let cur = e.firstElementChild;
		while (cur !== null) {
			this._cleanStyles(cur);
			cur = cur.nextElementSibling;
		}
	},

	_getLinkDensity: function (element) {
		let textLength = this._getInnerText(element).length;
		if (textLength === 0) return 0;

		let linkLength = 0;

		this._forEachNode(element.getElementsByTagName("a"), function (linkNode) {
			let href = linkNode.getAttribute("href");
			let coefficient = href && this.REGEXPS.hashUrl.test(href) ? 0.3 : 1;
			linkLength += this._getInnerText(linkNode).length * coefficient;
		});

		return linkLength / textLength;
	},

	_getClassWeight: function (e) {
		if (!this._flagIsActive(this.FLAG_WEIGHT_CLASSES)) return 0;

		let weight = 0;

		if (typeof e.className === "string" && e.className !== "") {
			if (this.REGEXPS.negative1.test(e.className) || this.REGEXPS.negative2.test(e.className)) weight -= 25;

			if (this.REGEXPS.positive.test(e.className)) weight += 25;
		}

		if (typeof e.id === "string" && e.id !== "") {
			if (this.REGEXPS.negative1.test(e.className) || this.REGEXPS.negative2.test(e.className)) weight -= 25;

			if (this.REGEXPS.positive.test(e.id)) weight += 25;
		}

		return weight;
	},

	_clean: function (e, tag) {
		let isEmbed = ["object", "embed", "iframe"].indexOf(tag) !== -1;

		this._removeNodes(this._getAllNodesWithTag(e, [tag]), function (element) {
			if (isEmbed) {
				for (const attr of element.attributes) {
					if (this.REGEXPS.videos.test(attr.value)) {
						return false;
					}
				}
				if (element.tagName === "object" && this.REGEXPS.videos.test(element.innerHTML)) {
					return false;
				}
			}

			return true;
		});
	},

	_hasAncestorTag: function (node, tagName, maxDepth, filterFn) {
		maxDepth = maxDepth || 3;
		tagName = tagName.toUpperCase();
		let depth = 0;
		while (node.parentNode) {
			if (maxDepth > 0 && depth > maxDepth) return false;
			if (node.parentNode.tagName === tagName && (!filterFn || filterFn(node.parentNode))) return true;
			node = node.parentNode;
			depth++;
		}
		return false;
	},

	_getRowAndColumnCount: function (table) {
		let rows = 0;
		let columns = 0;
		let trs = table.getElementsByTagName("tr");
		for (const tr of trs) {
			let rowspan = tr.getAttribute("rowspan") || 0;
			if (rowspan) {
				rowspan = parseInt(rowspan, 10);
			}
			rows += rowspan || 1;

			let columnsInThisRow = 0;
			const cells = tr.getElementsByTagName("td");
			for (const cell of cells) {
				let colspan = cell.getAttribute("colspan") || 0;
				if (colspan) {
					colspan = parseInt(colspan, 10);
				}
				columnsInThisRow += colspan || 1;
			}
			columns = Math.max(columns, columnsInThisRow);
		}

		return { rows: rows, columns: columns };
	},

	_markDataTables: function (root) {
		const tables = root.getElementsByTagName("table");
		const isDataTable = (table) => {
			const role = table.getAttribute("role");
			if (role === "presentation") return false;

			const datatable = table.getAttribute("datatable");
			if (datatable === "0") return false;

			const summary = table.getAttribute("summary");
			if (summary) return true;

			const caption = table.getElementsByTagName("caption")[0];
			if (caption && caption.childNodes.length > 0) return true;

			const dataTableDescendants = ["col", "colgroup", "tfoot", "thead", "th"];
			const descendantExists = (tag) => !!table.getElementsByTagName(tag)[0];
			if (dataTableDescendants.some(descendantExists)) {
				this.log("Data table because found data-y descendant");
				return true;
			}

			if (table.getElementsByTagName("table")[0]) return false;

			const sizeInfo = this._getRowAndColumnCount(table);
			if (sizeInfo.rows >= 10 || sizeInfo.columns > 4) return true;

			return sizeInfo.rows * sizeInfo.columns > 10;
		};

		for (const table of tables) {
			table._readabilityDataTable = isDataTable(table);
		}
	},

	_fixLazyImages: function (root) {
		const handleBase64Image = (elem) => {
			if (elem.src && this.REGEXPS.b64DataUrl.test(elem.src)) {
				const parts = this.REGEXPS.b64DataUrl.exec(elem.src);
				if (parts[1] === "image/svg+xml") {
					return;
				}

				let srcCouldBeRemoved = Array.from(elem.attributes).some(
					(attr) => attr.name !== "src" && /\.(jpg|jpeg|png|webp)/i.test(attr.value)
				);

				if (srcCouldBeRemoved) {
					const b64starts = elem.src.search(/base64\s*/i) + 7;
					const b64length = elem.src.length - b64starts;
					if (b64length < 133) {
						elem.removeAttribute("src");
					}
				}
			}
		};

		const handleLazyImages = (elem) => {
			if ((elem.src || (elem.srcset && elem.srcset != "null")) && elem.className.toLowerCase().indexOf("lazy") === -1) {
				return;
			}

			Array.from(elem.attributes).forEach((attr) => {
				if (attr.name === "src" || attr.name === "srcset" || attr.name === "alt") {
					return;
				}

				let copyTo = null;
				if (/\.(jpg|jpeg|png|webp)\s+\d/.test(attr.value)) {
					copyTo = "srcset";
				} else if (/^\s*\S+\.(jpg|jpeg|png|webp)\S*\s*$/.test(attr.value)) {
					copyTo = "src";
				}

				if (copyTo) {
					if (elem.tagName === "IMG" || elem.tagName === "PICTURE") {
						elem.setAttribute(copyTo, attr.value);
					} else if (elem.tagName === "FIGURE" && !this._getAllNodesWithTag(elem, ["img", "picture"]).length) {
						const img = this._doc.createElement("img");
						img.setAttribute(copyTo, attr.value);
						elem.appendChild(img);
					}
				}
			});
		};

		this._forEachNode(this._getAllNodesWithTag(root, ["img", "picture", "figure"]), (elem) => {
			handleBase64Image(elem);
			handleLazyImages(elem);
		});
	},

	_getTextDensity: function (e, tags) {
		let textLength = this._getInnerText(e, true).length;
		if (textLength === 0) {
			return 0;
		}
		let childrenLength = 0;
		let children = this._getAllNodesWithTag(e, tags);
		this._forEachNode(children, (child) => (childrenLength += this._getInnerText(child, true).length));
		return childrenLength / textLength;
	},

	_cleanConditionally: function (e, tag) {
		if (!this._flagIsActive(this.FLAG_CLEAN_CONDITIONALLY)) return;

		const isListNode = (node, tag) => {
			if (tag === "ul" || tag === "ol") return true;

			let listLength = 0;
			this._forEachNode(this._getAllNodesWithTag(node, ["ul", "ol"]), (list) => {
				listLength += this._getInnerText(list).length;
			});
			return listLength / this._getInnerText(node).length > 0.9;
		};

		const hasValidEmbedAttributes = (embed) => {
			for (const attr of embed.attributes) {
				if (this.REGEXPS.videos.test(attr.value)) return false;
			}
			return !(embed.tagName === "object" && this.REGEXPS.videos.test(embed.innerHTML));
		};

		const countValidEmbeds = (node) => {
			let embedCount = 0;
			for (const embed of this._getAllNodesWithTag(node, ["object", "embed", "iframe"])) {
				if (!hasValidEmbedAttributes(embed)) return { embedCount, isValid: false };
				embedCount++;
			}
			return { embedCount, isValid: true };
		};

		const shouldRemoveBasedOnConditions = ({
			node,
			tag,
			pCount,
			imgCount,
			liCount,
			inputCount,
			headingDensity,
			embedCount,
			linkDensity,
			contentLength,
			weight,
		}) => {
			return (
				(imgCount > 1 && pCount / imgCount < 0.5 && !this._hasAncestorTag(node, "figure")) ||
				(!isListNode(node, tag) && liCount > pCount) ||
				inputCount > Math.floor(pCount / 3) ||
				(!isListNode(node, tag) &&
					headingDensity < 0.9 &&
					contentLength < 25 &&
					(imgCount === 0 || imgCount > 2) &&
					!this._hasAncestorTag(node, "figure")) ||
				(!isListNode(node, tag) && weight < 25 && linkDensity > 0.2) ||
				(weight >= 25 && linkDensity > 0.5) ||
				(embedCount === 1 && contentLength < 75) ||
				embedCount > 1
			);
		};

		this._removeNodes(this._getAllNodesWithTag(e, [tag]), (node) => {
			let weight = this._getClassWeight(node);
			this.log("Cleaning Conditionally", node);

			let contentScore = 0;
			if (weight + contentScore < 0) return true;

			if (this._getCharCount(node, ",") >= 10) return false;

			let pCount = node.getElementsByTagName("p").length;
			let imgCount = node.getElementsByTagName("img").length;
			let liCount = node.getElementsByTagName("li").length - 100;
			let inputCount = node.getElementsByTagName("input").length;
			let headingDensity = this._getTextDensity(node, ["h1", "h2", "h3", "h4", "h5", "h6"]);
			let { embedCount, isValid } = countValidEmbeds(node);
			if (!isValid) return false;

			let linkDensity = this._getLinkDensity(node);
			let contentLength = this._getInnerText(node).length;

			return shouldRemoveBasedOnConditions({
				node,
				tag,
				pCount,
				imgCount,
				liCount,
				inputCount,
				headingDensity,
				embedCount,
				linkDensity,
				contentLength,
				weight,
			});
		});
	},

	_cleanMatchedNodes: function (e, filter) {
		let endOfSearchMarkerNode = this._getNextNode(e, true);
		let next = this._getNextNode(e);
		while (next && next != endOfSearchMarkerNode) {
			if (filter.call(this, next, next.className + " " + next.id)) {
				next = this._removeAndGetNext(next);
			} else {
				next = this._getNextNode(next);
			}
		}
	},

	_cleanHeaders: function (e) {
		let headingNodes = this._getAllNodesWithTag(e, ["h1", "h2"]);
		this._removeNodes(headingNodes, function (node) {
			let shouldRemove = this._getClassWeight(node) < 0;
			if (shouldRemove) {
				this.log("Removing header with low class weight:", node);
			}
			return shouldRemove;
		});
	},

	_headerDuplicatesTitle: function (node) {
		if (node.tagName != "H1" && node.tagName != "H2") {
			return false;
		}
		let heading = this._getInnerText(node, false);
		this.log("Evaluating similarity of header:", heading, this._articleTitle);
		return this._textSimilarity(this._articleTitle, heading) > 0.75;
	},

	_flagIsActive: function (flag) {
		return (this._flags & flag) > 0;
	},

	_removeFlag: function (flag) {
		this._flags = this._flags & ~flag;
	},

	_isProbablyVisible: function (node) {
		return (
			(!node.style || node.style.display != "none") &&
			!node.hasAttribute("hidden") &&
			// check for "fallback-image" so that wikimedia math images are displayed
			(!node.ariaHidden || node.ariaHidden !== "true" || node.className?.includes("fallback-image"))
		);
	},

	parse: function () {
		if (this._maxElemsToParse > 0) {
			let numTags = this._doc.getElementsByTagName("*").length;
			if (numTags > this._maxElemsToParse) {
				throw new Error("Aborting parsing document; " + numTags + " elements found");
			}
		}

		this._unwrapNoscriptImages(this._doc);

		let jsonLd = this._disableJSONLD ? {} : this._getJSONLD(this._doc);

		this._removeScripts(this._doc);

		this._prepDocument();

		let metadata = this._getArticleMetadata(jsonLd);
		this._articleTitle = metadata.title;

		let articleContent = this._grabArticle();
		if (!articleContent) return null;

		this.log("Grabbed: " + articleContent.innerHTML);

		this._postProcessContent(articleContent);

		if (!metadata.excerpt) {
			let paragraphs = articleContent.getElementsByTagName("p");
			if (paragraphs.length > 0) {
				metadata.excerpt = paragraphs[0].textContent.trim();
			}
		}

		let textContent = articleContent.textContent;
		return {
			title: this._articleTitle,
			byline: metadata.byline || this._articleByline,
			dir: this._articleDir,
			lang: this._articleLang,
			content: this._serializer(articleContent),
			textContent: textContent,
			length: textContent.length,
			excerpt: metadata.excerpt,
			siteName: metadata.siteName || this._articleSiteName,
		};
	},
};

if (typeof module === "object") {
	module.exports = Readability;
}

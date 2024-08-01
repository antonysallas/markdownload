let TurndownService = (function () {
	"use strict";

	function extend(destination) {
		for (let i = 1; i < arguments.length; i++) {
			let source = arguments[i];
			for (let key in source) {
				if (source.hasOwnProperty(key)) destination[key] = source[key];
			}
		}
		return destination;
	}

	function repeat(character, count) {
		return Array(count + 1).join(character);
	}

	function trimLeadingNewlines(string) {
		return string.replace(/^\n*/, "");
	}

	function trimTrailingNewlines(string) {
		let indexEnd = string.length;
		while (indexEnd > 0 && string[indexEnd - 1] === "\n") indexEnd--;
		return string.substring(0, indexEnd);
	}

	let blockElements = [
		"ADDRESS",
		"ARTICLE",
		"ASIDE",
		"AUDIO",
		"BLOCKQUOTE",
		"BODY",
		"CANVAS",
		"CENTER",
		"DD",
		"DIR",
		"DIV",
		"DL",
		"DT",
		"FIELDSET",
		"FIGCAPTION",
		"FIGURE",
		"FOOTER",
		"FORM",
		"FRAMESET",
		"H1",
		"H2",
		"H3",
		"H4",
		"H5",
		"H6",
		"HEADER",
		"HGROUP",
		"HR",
		"HTML",
		"ISINDEX",
		"LI",
		"MAIN",
		"MENU",
		"NAV",
		"NOFRAMES",
		"NOSCRIPT",
		"OL",
		"OUTPUT",
		"P",
		"PRE",
		"SECTION",
		"TABLE",
		"TBODY",
		"TD",
		"TFOOT",
		"TH",
		"THEAD",
		"TR",
		"UL",
	];

	function isBlock(node) {
		return is(node, blockElements);
	}

	let voidElements = [
		"AREA",
		"BASE",
		"BR",
		"COL",
		"COMMAND",
		"EMBED",
		"HR",
		"IMG",
		"INPUT",
		"KEYGEN",
		"LINK",
		"META",
		"PARAM",
		"SOURCE",
		"TRACK",
		"WBR",
	];

	function isVoid(node) {
		return is(node, voidElements);
	}

	function hasVoid(node) {
		return has(node, voidElements);
	}

	let meaningfulWhenBlankElements = [
		"A",
		"TABLE",
		"THEAD",
		"TBODY",
		"TFOOT",
		"TH",
		"TD",
		"IFRAME",
		"SCRIPT",
		"AUDIO",
		"VIDEO",
	];

	function isMeaningfulWhenBlank(node) {
		return is(node, meaningfulWhenBlankElements);
	}

	function hasMeaningfulWhenBlank(node) {
		return has(node, meaningfulWhenBlankElements);
	}

	function is(node, tagNames) {
		return tagNames.indexOf(node.nodeName) >= 0;
	}

	function has(node, tagNames) {
		return (
			node.getElementsByTagName &&
			tagNames.some(function (tagName) {
				return node.getElementsByTagName(tagName).length;
			})
		);
	}

	let rules = {};

	rules.paragraph = {
		filter: "p",

		replacement: function (content) {
			return "\n\n" + content + "\n\n";
		},
	};

	rules.lineBreak = {
		filter: "br",

		replacement: function (content, node, options) {
			return options.br + "\n";
		},
	};

	rules.heading = {
		filter: ["h1", "h2", "h3", "h4", "h5", "h6"],

		replacement: function (content, node, options) {
			let hLevel = Number(node.nodeName.charAt(1));

			if (options.headingStyle === "setext" && hLevel < 3) {
				let underline = repeat(hLevel === 1 ? "=" : "-", content.length);
				return "\n\n" + content + "\n" + underline + "\n\n";
			} else {
				return "\n\n" + repeat("#", hLevel) + " " + content + "\n\n";
			}
		},
	};

	rules.blockquote = {
		filter: "blockquote",

		replacement: function (content) {
			content = content.replace(/(^\n+)|(\n+$)/g, "");
			content = content.replace(/^/gm, "> ");
			return "\n\n" + content + "\n\n";
		},
	};

	rules.list = {
		filter: ["ul", "ol"],

		replacement: function (content, node) {
			let parent = node.parentNode;
			if (parent.nodeName === "LI" && parent.lastElementChild === node) {
				return "\n" + content;
			} else {
				return "\n\n" + content + "\n\n";
			}
		},
	};

	rules.listItem = {
		filter: "li",

		replacement: function (content, node, options) {
			let prefix = options.bulletListMarker + "   ";
			let parent = node.parentNode;

			if (parent.nodeName === "OL") {
				let start = parent.getAttribute("start");
				let index = Array.prototype.indexOf.call(parent.children, node);
				prefix = (start ? Number(start) + index : index + 1) + ".  ";
			}

			// Check if content ends with a newline character
			let suffix = node.nextSibling && !content.endsWith("\n") ? "\n" : "";

			return prefix + content + suffix;
		},
	};

	rules.indentedCodeBlock = {
		filter: function (node, options) {
			return (
				options.codeBlockStyle === "indented" &&
				node.nodeName === "PRE" &&
				node.firstChild &&
				node.firstChild.nodeName === "CODE"
			);
		},

		replacement: function (content, node, options) {
			return "\n\n    " + node.firstChild.textContent.replace(/\n/g, "\n    ") + "\n\n";
		},
	};

	rules.fencedCodeBlock = {
		filter: function (node, options) {
			return (
				options.codeBlockStyle === "fenced" &&
				node.nodeName === "PRE" &&
				node.firstChild &&
				node.firstChild.nodeName === "CODE"
			);
		},

		replacement: function (content, node, options) {
			let className = node.firstChild.getAttribute("class") || "";
			let language = (className.match(/language-(\S+)/) || [null, ""])[1];
			let code = node.firstChild.textContent;

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
		},
	};

	rules.horizontalRule = {
		filter: "hr",

		replacement: function (content, node, options) {
			return "\n\n" + options.hr + "\n\n";
		},
	};

	rules.inlineLink = {
		filter: function (node, options) {
			return options.linkStyle === "inlined" && node.nodeName === "A" && node.getAttribute("href");
		},

		replacement: function (content, node) {
			let href = node.getAttribute("href");
			let title = cleanAttribute(node.getAttribute("title"));
			if (title) title = ' "' + title + '"';
			return "[" + content + "](" + href + title + ")";
		},
	};

	rules.referenceLink = {
		filter: function (node, options) {
			return options.linkStyle === "referenced" && node.nodeName === "A" && node.getAttribute("href");
		},

		replacement: function (content, node, options) {
			let href = node.getAttribute("href");
			let title = cleanAttribute(node.getAttribute("title"));
			if (title) title = ' "' + title + '"';
			let replacement;
			let reference;

			switch (options.linkReferenceStyle) {
				case "collapsed": {
					replacement = "[" + content + "][]";
					reference = "[" + content + "]: " + href + title;
					break;
				}
				case "shortcut": {
					replacement = "[" + content + "]";
					reference = "[" + content + "]: " + href + title;
					break;
				}
				default: {
					let id = this.references.length + 1;
					replacement = "[" + content + "][" + id + "]";
					reference = "[" + id + "]: " + href + title;
					break;
				}
			}

			this.references.push(reference);
			return replacement;
		},

		references: [],

		append: function (options) {
			let references = "";
			if (this.references.length) {
				references = "\n\n" + this.references.join("\n") + "\n\n";
			}
			return references;
		},
	};

	rules.emphasis = {
		filter: ["em", "i"],

		replacement: function (content, node, options) {
			if (!content.trim()) return "";
			return options.emDelimiter + content + options.emDelimiter;
		},
	};

	rules.strong = {
		filter: ["strong", "b"],

		replacement: function (content, node, options) {
			if (!content.trim()) return "";
			return options.strongDelimiter + content + options.strongDelimiter;
		},
	};

	rules.code = {
		filter: function (node) {
			let hasSiblings = node.previousSibling || node.nextSibling;
			let isCodeBlock = node.parentNode.nodeName === "PRE" && !hasSiblings;

			return node.nodeName === "CODE" && !isCodeBlock;
		},

		replacement: function (content) {
			if (!content) return "";
			content = content.replace(/\r?\n|\r/g, " ");

			let extraSpace = /^`|^ .*?[^ ].* $|`$/.test(content) ? " " : "";
			let delimiter = "`";
			let matches = content.match(/`+/gm) || [];
			while (matches.indexOf(delimiter) !== -1) delimiter = delimiter + "`";

			return delimiter + extraSpace + content + extraSpace + delimiter;
		},
	};

	rules.image = {
		filter: "img",

		replacement: function (content, node) {
			let alt = cleanAttribute(node.getAttribute("alt"));
			let src = node.getAttribute("src") || "";
			let title = cleanAttribute(node.getAttribute("title"));
			let titlePart = title ? ' "' + title + '"' : "";
			return src ? "![" + alt + "]" + "(" + src + titlePart + ")" : "";
		},
	};

	function cleanAttribute(attribute) {
		return attribute ? attribute.replace(/(\n+\s*)+/g, "\n") : "";
	}

	/**
	 * Manages a collection of rules used to convert HTML to Markdown
	 */

	function Rules(options) {
		this.options = options;
		this._keep = [];
		this._remove = [];

		this.blankRule = {
			replacement: options.blankReplacement,
		};

		this.keepReplacement = options.keepReplacement;

		this.defaultRule = {
			replacement: options.defaultReplacement,
		};

		this.array = [];
		for (let key in options.rules) this.array.push(options.rules[key]);
	}

	Rules.prototype = {
		add: function (key, rule) {
			this.array.unshift(rule);
		},

		keep: function (filter) {
			this._keep.unshift({
				filter: filter,
				replacement: this.keepReplacement,
			});
		},

		remove: function (filter) {
			this._remove.unshift({
				filter: filter,
				replacement: function () {
					return "";
				},
			});
		},

		forNode: function (node) {
			if (node.isBlank) return this.blankRule;
			let rule;

			rule = findRule(this.array, node, this.options);
			if (rule) return rule;

			rule = findRule(this._keep, node, this.options);
			if (rule) return rule;

			rule = findRule(this._remove, node, this.options);
			if (rule) return rule;

			return this.defaultRule;
		},

		forEach: function (fn) {
			for (let i = 0; i < this.array.length; i++) fn(this.array[i], i);
		},
	};

	function findRule(rules, node, options) {
		for (const rule of rules) {
			if (filterValue(rule, node, options)) return rule;
		}
		return undefined;
	}

	function filterValue(rule, node, options) {
		let filter = rule.filter;
		if (typeof filter === "string") {
			if (filter === node.nodeName.toLowerCase()) return true;
		} else if (Array.isArray(filter)) {
			if (filter.indexOf(node.nodeName.toLowerCase()) > -1) return true;
		} else if (typeof filter === "function") {
			if (filter.call(rule, node, options)) return true;
		} else {
			throw new TypeError("`filter` needs to be a string, array, or function");
		}
	}

	function collapseWhitespace(options) {
		let element = options.element;
		let isBlock = options.isBlock;
		let isVoid = options.isVoid;
		let isPre = options.isPre || ((node) => node?.nodeName === "PRE");

		if (!element.firstChild || isPre(element)) return;

		let prevText = null;
		let keepLeadingWs = false;
		let prev = null;
		let node = next(prev, element, isPre);

		while (node !== element) {
			if (node === null) {
				break;
			}
			({ node, prevText, keepLeadingWs } = processNode(node, prevText, keepLeadingWs, isBlock, isVoid, isPre));
			prev = node;
			node = next(prev, node, isPre);
		}

		finalizePrevText(prevText);
	}

	function processNode(node, prevText, keepLeadingWs, isBlock, isVoid, isPre) {
		if (node.nodeType === 3 || node.nodeType === 4) {
			let text = node.data.replace(/[ \r\n\t]+/g, " ");

			if ((!prevText || prevText.data?.endsWith(" ")) && !keepLeadingWs && text.startsWith(" ")) {
				text = text.substring(1);
			}

			if (!text) {
				node = remove(node);
			} else {
				node.data = text;
			}

			prevText = node;
		} else if (node.nodeType === 1) {
			if (isBlock(node) || node.nodeName === "BR") {
				if (prevText && prevText.data) {
					prevText.data = prevText.data.replace(/ $/, "");
				}
				prevText = null;
				keepLeadingWs = false;
			} else if (isVoid(node) || isPre(node)) {
				prevText = null;
				keepLeadingWs = true;
			} else if (prevText) {
				keepLeadingWs = false;
			}
		} else {
			node = remove(node);
		}

		return { node, prevText, keepLeadingWs };
	}

	function updatePrevText(node, prevText) {
		if (node.nodeType === 3 || node.nodeType === 4) {
			prevText = node;
		} else if (node.nodeType === 1) {
			prevText = null;
		}
		return prevText;
	}

	function updateKeepLeadingWs(node, keepLeadingWs, isBlock, isVoid, isPre) {
		if (node.nodeType === 1) {
			if (isBlock(node) || node.nodeName === "BR" || isVoid(node) || isPre(node)) {
				keepLeadingWs = false;
			} else {
				keepLeadingWs = true;
			}
		}
		return keepLeadingWs;
	}

	function finalizePrevText(prevText) {
		if (prevText && prevText.data) {
			prevText.data = prevText.data.replace(/ $/, "");
			if (!prevText.data) {
				remove(prevText);
			}
		}
	}

	function remove(node) {
		let next = node.nextSibling || node.parentNode;

		node.parentNode.removeChild(node);

		return next;
	}

	function next(prev, current, isPre) {
		if ((prev && prev.parentNode === current) || isPre(current)) {
			return current.nextSibling || current.parentNode;
		}

		return current.firstChild || current.nextSibling || current.parentNode;
	}

	let root = typeof window !== "undefined" ? window : {};

	function canParseHTMLNatively() {
		let Parser = root.DOMParser;
		let canParse = false;

		try {
			if (new Parser().parseFromString("", "text/html")) {
				canParse = true;
			}
		} catch (e) {}

		return canParse;
	}

	function createHTMLParser() {
		let parseFromString;

		if (shouldUseActiveX()) {
			parseFromString = function (string) {
				let doc = new window.ActiveXObject("htmlfile");
				doc.open();
				doc.write(string);
				doc.close();
				return doc;
			};
		} else {
			parseFromString = function (string) {
				let doc = document.implementation.createHTMLDocument("");
				doc.open();
				doc.write(string);
				doc.close();
				return doc;
			};
		}

		return {
			parseFromString: parseFromString,
		};
	}

	function shouldUseActiveX() {
		let useActiveX = false;
		try {
			document.implementation.createHTMLDocument("").open();
		} catch (e) {
			if (window.ActiveXObject) useActiveX = true;
		}
		return useActiveX;
	}

	let HTMLParser = canParseHTMLNatively() ? root.DOMParser : createHTMLParser();

	function RootNode(input, options) {
		let root;
		if (typeof input === "string") {
			let doc = htmlParser().parseFromString('<x-turndown id="turndown-root">' + input + "</x-turndown>", "text/html");
			root = doc.getElementById("turndown-root");
		} else {
			root = input.cloneNode(true);
		}
		collapseWhitespace({
			element: root,
			isBlock: isBlock,
			isVoid: isVoid,
			isPre: options.preformattedCode ? isPreOrCode : null,
		});

		return root;
	}

	let _htmlParser;
	function htmlParser() {
		_htmlParser = _htmlParser || new HTMLParser();
		return _htmlParser;
	}

	function isPreOrCode(node) {
		return node.nodeName === "PRE" || node.nodeName === "CODE";
	}

	function Node(node, options) {
		node.isBlock = isBlock(node);
		node.isCode = node.nodeName === "CODE" || node.parentNode.isCode;
		node.isBlank = isBlank(node);
		node.flankingWhitespace = flankingWhitespace(node, options);
		return node;
	}

	function isBlank(node) {
		return (
			!isVoid(node) &&
			!isMeaningfulWhenBlank(node) &&
			/^\s*$/i.test(node.textContent) &&
			!hasVoid(node) &&
			!hasMeaningfulWhenBlank(node)
		);
	}

	function flankingWhitespace(node, options) {
		if (node.isBlock || (options.preformattedCode && node.isCode)) {
			return { leading: "", trailing: "" };
		}

		let edges = edgeWhitespace(node.textContent);

		if (edges.leadingAscii && isFlankedByWhitespace("left", node, options)) {
			edges.leading = edges.leadingNonAscii;
		}

		if (edges.trailingAscii && isFlankedByWhitespace("right", node, options)) {
			edges.trailing = edges.trailingNonAscii;
		}

		return { leading: edges.leading, trailing: edges.trailing };
	}

	function edgeWhitespace(string) {
		let m = string.match(/^(([ \t\r\n]*)(\s*))[\s\S]*?((\s*?)([ \t\r\n]*))$/);
		return {
			leadingAscii: m[2],
			leadingNonAscii: m[3],
			trailingNonAscii: m[5],
			trailingAscii: m[6],
		};
	}

	function isFlankedByWhitespace(side, node, options) {
		let sibling;
		let regExp;
		let isFlanked;

		if (side === "left") {
			sibling = node.previousSibling;
			regExp = / $/;
		} else {
			sibling = node.nextSibling;
			regExp = /^ /;
		}

		if (sibling) {
			if (sibling.nodeType === 3) {
				isFlanked = regExp.test(sibling.nodeValue);
			} else if (options.preformattedCode && sibling.nodeName === "CODE") {
				isFlanked = false;
			} else if (sibling.nodeType === 1 && !isBlock(sibling)) {
				isFlanked = regExp.test(sibling.textContent);
			}
		}
		return isFlanked;
	}

	let reduce = Array.prototype.reduce;
	let escapes = [
		[/\\/g, "\\\\"],
		[/\*/g, "\\*"],
		[/^-/g, "\\-"],
		[/^\+ /g, "\\+ "],
		[/^(=+)/g, "\\$1"],
		[/^(#{1,6}) /g, "\\$1 "],
		[/`/g, "\\`"],
		[/^~~~/g, "\\~~~"],
		[/\[/g, "\\["],
		[/\]/g, "\\]"],
		[/^>/g, "\\>"],
		[/_/g, "\\_"],
		[/^(\d+)\. /g, "$1\\. "],
	];

	function TurndownService(options) {
		if (!(this instanceof TurndownService)) return new TurndownService(options);

		let defaults = {
			rules: rules,
			headingStyle: "setext",
			hr: "* * *",
			bulletListMarker: "*",
			codeBlockStyle: "indented",
			fence: "```",
			emDelimiter: "_",
			strongDelimiter: "**",
			linkStyle: "inlined",
			linkReferenceStyle: "full",
			br: "  ",
			preformattedCode: false,
			blankReplacement: function (content, node) {
				return node.isBlock ? "\n\n" : "";
			},
			keepReplacement: function (content, node) {
				return node.isBlock ? "\n\n" + node.outerHTML + "\n\n" : node.outerHTML;
			},
			defaultReplacement: function (content, node) {
				return node.isBlock ? "\n\n" + content + "\n\n" : content;
			},
		};
		this.options = extend({}, defaults, options);
		this.rules = new Rules(this.options);
	}

	TurndownService.prototype = {
		turndown: function (input) {
			if (!canConvert(input)) {
				throw new TypeError(input + " is not a string, or an element/document/fragment node.");
			}

			if (input === "") return "";

			let output = process.call(this, new RootNode(input, this.options));
			return postProcess.call(this, output);
		},

		use: function (plugin) {
			if (Array.isArray(plugin)) {
				for (const p of plugin) {
					this.use(p);
				}
			} else if (typeof plugin === "function") {
				plugin(this);
			} else {
				throw new TypeError("plugin must be a Function or an Array of Functions");
			}
			return this;
		},

		addRule: function (key, rule) {
			this.rules.add(key, rule);
			return this;
		},

		keep: function (filter) {
			this.rules.keep(filter);
			return this;
		},

		remove: function (filter) {
			this.rules.remove(filter);
			return this;
		},

		escape: function (string) {
			return escapes.reduce(function (accumulator, escape) {
				return accumulator.replace(escape[0], escape[1]);
			}, string);
		},
	};

	function process(parentNode) {
		let self = this;
		return reduce.call(
			parentNode.childNodes,
			function (output, node) {
				node = new Node(node, self.options);

				let replacement = "";
				if (node.nodeType === 3) {
					replacement = node.isCode ? node.nodeValue : self.escape(node.nodeValue);
				} else if (node.nodeType === 1) {
					replacement = replacementForNode.call(self, node);
				}

				return join(output, replacement);
			},
			""
		);
	}

	function postProcess(output) {
		let self = this;
		this.rules.forEach(function (rule) {
			if (typeof rule.append === "function") {
				output = join(output, rule.append(self.options));
			}
		});

		return output.replace(/^[\t\r\n]+/, "").replace(/[ \t\r\n]+$/, "");
	}

	function replacementForNode(node) {
		let rule = this.rules.forNode(node);
		let content = process.call(this, node);
		let whitespace = node.flankingWhitespace;
		if (whitespace.leading || whitespace.trailing) content = content.trim();
		return whitespace.leading + rule.replacement(content, node, this.options) + whitespace.trailing;
	}

	function join(output, replacement) {
		let s1 = trimTrailingNewlines(output);
		let s2 = trimLeadingNewlines(replacement);
		let nls = Math.max(output.length - s1.length, replacement.length - s2.length);
		let separator = "\n\n".substring(0, nls);

		return s1 + separator + s2;
	}

	function canConvert(input) {
		return (
			input != null &&
			(typeof input === "string" ||
				(input.nodeType && (input.nodeType === 1 || input.nodeType === 9 || input.nodeType === 11)))
		);
	}

	return TurndownService;
})();

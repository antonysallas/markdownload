// these are the default options
const defaultOptions = {
  headingStyle: "atx",
  hr: "- ---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  fence: "```",
  emDelimiter: "_",
  strongDelimiter: "**",
  linkStyle: "inlined",
  linkReferenceStyle: "full",
  imageStyle: "markdown",
  imageRefStyle: "inlined",
  // frontmatter:
  //   "---\ncreated: {date:YYYY-MM-DDTHH:mm:ss} (UTC {date:Z})\ntags: [{keywords}]\nsource: {baseURI}\nauthor: {byline}\n---\n\n# {pageTitle}\n\n> ## Excerpt\n> {excerpt}\n\n---",
  frontmatter: `
title:: {title}
date:: [[{lsDate}]]
created-time:: {lsDateTime}
tags:: {keywords}
source:: {baseURI}
author:: [[{byline}]]
location:: {lsLocation}
---

- # {pageTitle}

  - ## Excerpt
    > {excerpt}
  - ---\n`,
  backmatter: "",
  title: "{date:YYYYDDMMhhmmss}_{pageTitle}",
  includeTemplate: true,
  saveAs: false,
  downloadImages: true,
  imagePrefix: "assets/articles/",
  mdClipsFolder: "pages/",
  mdAssetsFolder: "assets/",
  disallowedChars: "[]#^",
  downloadMode: "downloadsApi",
  turndownEscape: true,
  contextMenus: true,
  obsidianIntegration: false,
  obsidianVault: "",
  obsidianFolder: "",
};

// function to get the options from storage and substitute default options if it fails
async function getOptions() {
  let options = defaultOptions;
  try {
    options = await browser.storage.sync.get(defaultOptions);
  } catch (err) {
    console.error(err);
  }
  if (!browser.downloads) options.downloadMode = "contentLink";
  return options;
}

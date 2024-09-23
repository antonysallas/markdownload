// these are the default options
const defaultOptions = {
  headingStyle: "atx",
  hr: "___",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  fence: "```",
  emDelimiter: "_",
  strongDelimiter: "**",
  linkStyle: "inlined",
  linkReferenceStyle: "full",
  imageStyle: "markdown",
  imageRefStyle: "inlined",
  frontmatter: `
title:: {title}
date:: [[{lsDate}]]
created-time:: {lsDateTime}
tags:: {keywords}
source:: {baseURI}
author:: [[{byline}]]
location:: {lsLocation}
---

- ## Excerpt
  > {excerpt}

  - ---\n\n`,
  backmatter: "",
  title: "{pageTitle}",
  includeTemplate: false,
  saveAs: false,
  downloadImages: false,
  imagePrefix: "{pageTitle}/",
  mdClipsFolder: null,
  mdAssetsFolder: null,
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

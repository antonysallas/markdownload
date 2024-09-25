const fs = require("fs");
const path = require("path");

// Define paths
const manifestPath = path.join(__dirname, "manifest.json");
const chromeManifestPath = path.join(__dirname, "manifest.chrome.json");

// Read the original manifest.json file
fs.readFile(manifestPath, "utf8", (err, data) => {
  if (err) {
    console.error("Error reading manifest.json:", err);
    return;
  }

  // Parse the JSON content of manifest.json
  let manifest = JSON.parse(data);

  // Remove the Firefox-specific "browser_specific_settings" key
  if (manifest.browser_specific_settings) {
    delete manifest.browser_specific_settings;
  }

  // Write the modified manifest to a new file manifest.chrome.json
  fs.writeFile(chromeManifestPath, JSON.stringify(manifest, null, 2), "utf8", (err) => {
    if (err) {
      console.error("Error writing manifest.chrome.json:", err);
      return;
    }
    console.log("Chrome manifest prepared successfully as manifest.chrome.json");
  });
});

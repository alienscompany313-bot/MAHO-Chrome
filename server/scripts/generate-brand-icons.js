"use strict";
const fs = require("fs");
const path = require("path");
const { Resvg } = require("@resvg/resvg-js");

const logoPath = path.join(__dirname, "..", "..", "website", "assets", "brand", "maho-logo.jpg");
const logo = fs.readFileSync(logoPath).toString("base64");
const root = path.join(__dirname, "..", "..");

function pngFromSvg(svg, width) {
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: width } });
  return resvg.render().asPng();
}

function square(size) {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <image href="data:image/jpeg;base64,${logo}" x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>
</svg>`;
  return pngFromSvg(svg, size);
}

fs.writeFileSync(path.join(root, "icon-512.png"), square(512));
fs.writeFileSync(path.join(root, "icon-192.png"), square(192));
fs.writeFileSync(path.join(root, "website", "apple-touch-icon.png"), square(180));
fs.writeFileSync(path.join(root, "website", "favicon-32.png"), square(32));
console.log("icons", fs.statSync(path.join(root, "icon-512.png")).size);

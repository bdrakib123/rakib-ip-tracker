"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicDir = path.join(__dirname, "..", "public");
const style = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");

test("public and admin shells declare responsive viewport sizing", () => {
  for (const file of ["index.html", "admin.html"]) {
    const html = fs.readFileSync(path.join(publicDir, file), "utf8");
    assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
  }
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  assert.match(html, /leaflet@1\.9\.4\/dist\/leaflet\.js/);
  assert.match(html, /id="profile-map"/);
  assert.match(style, /\.profile-map\s*\{[^}]*height:/);
});

test("styles include narrow Android, tablet, desktop and reduced-motion safeguards", () => {
  assert.match(style, /min-width:\s*320px/);
  assert.match(style, /@media\s*\(max-width:\s*360px\)/);
  assert.match(style, /@media\s*\(max-width:\s*620px\)/);
  assert.match(style, /@media\s*\(max-width:\s*920px\)/);
  assert.match(style, /prefers-reduced-motion:\s*reduce/);
  assert.match(style, /grid-template-columns:\s*repeat\(\d+,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(style, /\.profile-grid\s*\{[^}]*minmax\(0,\s*1fr\)/s);
});

"use strict";

// Give Vercel a recognized root Express entrypoint. Keep application setup and
// its lazy initialization in the existing Vercel handler.
const express = require("express");
const functionApp = require("./src/index");

if (typeof express !== "function" || typeof functionApp !== "function") {
  throw new TypeError("The Vercel Express entrypoint must export a callable handler.");
}

module.exports = functionApp;

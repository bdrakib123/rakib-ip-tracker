"use strict";

const https = require("node:https");

function createIpv4Fetch({ request = https.request, timeoutMs = 20_000 } = {}) {
  return function ipv4Fetch(input, init = {}) {
    const url = input instanceof URL ? input : new URL(input);

    return new Promise((resolve, reject) => {
      const signal = init.signal;
      let settled = false;
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      const settle = (handler, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        handler(value);
      };
      const onAbort = () => {
        const error = new Error("Request aborted");
        error.name = "AbortError";
        outgoing.destroy(error);
      };

      const outgoing = request(url, {
        method: init.method || "GET",
        headers: init.headers,
        family: 4,
        timeout: timeoutMs
      }, incoming => {
        const chunks = [];
        incoming.on("data", chunk => chunks.push(chunk));
        incoming.on("error", error => settle(reject, error));
        incoming.on("end", () => {
          try {
            settle(resolve, new Response(Buffer.concat(chunks), {
              status: incoming.statusCode,
              statusText: incoming.statusMessage,
              headers: incoming.headers
            }));
          } catch (error) {
            settle(reject, error);
          }
        });
      });

      outgoing.on("timeout", () => outgoing.destroy(new Error("IPv4 HTTPS timeout")));
      outgoing.on("error", error => settle(reject, error));
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }
      if (init.body !== undefined && init.body !== null) outgoing.write(init.body);
      outgoing.end();
    });
  };
}

const ipv4Fetch = createIpv4Fetch();

function configureNeonFetch(neonConfig, forceIpv4) {
  if (forceIpv4) neonConfig.fetchFunction = ipv4Fetch;
}

module.exports = { configureNeonFetch, createIpv4Fetch, ipv4Fetch };

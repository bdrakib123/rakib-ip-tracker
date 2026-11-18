"use strict";

const { isIP } = require("node:net");

function normalizeIP(value) {
  const ip = String(value || "").trim();
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  return ip;
}

function ipv4Octets(ip) {
  return ip.split(".").map(Number);
}

function ipv6Groups(ip) {
  const halves = ip.toLowerCase().split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length > 1 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  return [...left, ...Array(missing).fill("0"), ...right].map(part => parseInt(part || "0", 16));
}

function isPrivateIP(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ipv4Octets(ip);
    return a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168);
  }
  if (isIP(ip) !== 6) return false;
  const groups = ipv6Groups(ip);
  if (!groups) return false;
  if (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff) {
    return isPrivateIP(`${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`);
  }
  return groups.every(group => group === 0) ||
    (groups.slice(0, 7).every(group => group === 0) && groups[7] === 1) ||
    (groups[0] & 0xfe00) === 0xfc00 ||
    (groups[0] & 0xffc0) === 0xfe80;
}

function isNonPublicIP(ip) {
  if (isIP(ip) === 4) {
    const [a, b, c] = ipv4Octets(ip);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113);
  }
  if (isIP(ip) !== 6) return true;
  const groups = ipv6Groups(ip);
  if (!groups) return true;
  if (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff) {
    return isNonPublicIP(`${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`);
  }
  return groups.every(group => group === 0) ||
    (groups.slice(0, 7).every(group => group === 0) && groups[7] === 1) ||
    (groups[0] & 0xfe00) === 0xfc00 ||
    (groups[0] & 0xffc0) === 0xfe80 ||
    (groups[0] & 0xffc0) === 0xfec0 ||
    (groups[0] & 0xff00) === 0xff00 ||
    (groups[0] === 0x2001 && groups[1] === 0x0db8);
}

function maskIP(value) {
  const ip = normalizeIP(value);
  if (isIP(ip) === 4) return `${ip.split(".").slice(0, 3).join(".")}.xxx`;
  if (isIP(ip) === 6) return `${ip.split(":").slice(0, 3).join(":")}:xxxx`;
  return "Unavailable";
}

function getRequestIP(req) {
  return normalizeIP(req.ip || req.socket?.remoteAddress || "");
}

module.exports = { getRequestIP, isNonPublicIP, isPrivateIP, maskIP, normalizeIP };

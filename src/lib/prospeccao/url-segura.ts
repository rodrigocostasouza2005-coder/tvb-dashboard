import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function publicIpv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a,b,c] = p;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function publicIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  // Only globally-routable 2000::/3 addresses are accepted. This excludes
  // loopback, link-local, unique-local, multicast, IPv4-mapped and NAT64 ranges.
  const first = Number.parseInt(normalized.split(":")[0] || "0", 16);
  return Number.isFinite(first) && first >= 0x2000 && first <= 0x3fff;
}

export function isPublicAddress(ip: string): boolean {
  const version = isIP(ip);
  return version === 4 ? publicIpv4(ip) : version === 6 ? publicIpv6(ip) : false;
}

export async function isSafePublicHttpsUrl(value: string): Promise<boolean> {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost") ||
        host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test")) return false;
    if (isIP(host)) return false;
    const addresses = await lookup(host, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every((entry) => isPublicAddress(entry.address));
  } catch {
    return false;
  }
}

import { lookup } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const)
  blocked.addSubnet(address, prefix, "ipv6");

export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) return !blocked.check(address, "ipv4");
  return isIP(address) === 6 && /^[23]/.test(address) && !blocked.check(address, "ipv6");
}

// Проверяем именно адреса, передаваемые сокету. Второго DNS-запроса перед подключением нет.
const lookupPublic: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    if (!addresses.length || addresses.some(({ address }) => !publicAddress(address)))
      return callback(new Error("Недоступный сетевой адрес"), "", 0);
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
};

type PageRequest = { headers: Record<string, string>; signal: AbortSignal; redirect: "manual" };

async function requestPage(url: URL, init: PageRequest): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(url, { headers: init.headers, lookup: lookupPublic, signal: init.signal }, (res) => {
      const headers = new Headers();
      for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
      const status = res.statusCode ?? 502;
      const noBody = [204, 205, 304].includes(status);
      if (noBody) res.resume();
      resolve(new Response(noBody ? null : Readable.toWeb(res) as ReadableStream<Uint8Array>, { status, headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

export async function fetchPublicPage(start: string, init: PageRequest, transport?: typeof fetch) {
  let url = new URL(start);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || host === "localhost" ||
        host.endsWith(".localhost") || (isIP(host) && !publicAddress(host))) throw new Error("Недоступный адрес страницы");
    const response = transport ? await transport(url.href, init) : await requestPage(url, init);
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, url: url.href };
    await response.body?.cancel();
    const next = response.headers.get("location");
    if (!next) throw new Error("Перенаправление без адреса");
    url = new URL(next, url);
  }
  throw new Error("Слишком много перенаправлений");
}

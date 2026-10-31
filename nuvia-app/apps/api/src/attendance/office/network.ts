import * as ipaddr from 'ipaddr.js';

/** Parses 'a.b.c.d/nn' or an IPv6 CIDR. Throws on a bad entry so a typo in config fails at startup. */
export function parseCidrs(cidrs: string[]): [ipaddr.IPv4 | ipaddr.IPv6, number][] {
  return cidrs.map((c) => {
    try {
      return ipaddr.parseCIDR(c);
    } catch {
      throw new Error(`OFFICE_NETWORK_CIDRS: "${c}" is not a valid CIDR`);
    }
  });
}

/** True when `ip` falls inside any of the parsed ranges. IPv4-mapped IPv6 addresses are unwrapped first. */
export function ipInRanges(ip: string | undefined, ranges: [ipaddr.IPv4 | ipaddr.IPv6, number][]): boolean {
  if (!ip || !ipaddr.isValid(ip)) return false;
  const addr = ipaddr.process(ip);
  return ranges.some(([range, bits]) => addr.kind() === range.kind() && addr.match(range as any, bits));
}

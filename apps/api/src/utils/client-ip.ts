function normalizeIpCandidate(input: string): string {
  let normalized = input.trim();

  if (normalized.startsWith('::ffff:')) {
    normalized = normalized.slice(7);
  }

  if (normalized.startsWith('[')) {
    const end = normalized.indexOf(']');
    if (end !== -1) {
      normalized = normalized.slice(1, end);
    }
    return normalized;
  }

  const lastColon = normalized.lastIndexOf(':');
  if (lastColon > -1 && normalized.indexOf(':') === lastColon) {
    const port = normalized.slice(lastColon + 1);
    if (/^\d+$/.test(port)) {
      normalized = normalized.slice(0, lastColon);
    }
  }

  return normalized;
}

function isValidIpv4(ip: string): boolean {
  const octets = ip.split('.');
  return octets.length === 4 && octets.every((octet) => {
    if (!/^\d+$/.test(octet)) return false;
    const value = Number(octet);
    return value >= 0 && value <= 255;
  });
}

function isValidIpv6(ip: string): boolean {
  return ip.includes(':');
}

function isPrivateIpv4(ip: string): boolean {
  if (!isValidIpv4(ip)) return false;

  const octets = ip.split('.').map(Number);
  return (
    octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 169 && octets[1] === 254)
    || octets[0] === 127
  );
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
}

type IpCandidate = {
  value: string;
  isIpv4: boolean;
  isPrivate: boolean;
};

function toCandidate(input: string): IpCandidate | null {
  const value = normalizeIpCandidate(input);
  if (!value) return null;

  if (isValidIpv4(value)) {
    return { value, isIpv4: true, isPrivate: isPrivateIpv4(value) };
  }

  if (isValidIpv6(value)) {
    return { value, isIpv4: false, isPrivate: isPrivateIpv6(value) };
  }

  return null;
}

export function selectClientIpFromHeaders(headers: Headers): string | null {
  const rawCandidates = [
    ...((headers.get('x-forwarded-for') ?? '').split(',')),
    headers.get('x-real-ip') ?? '',
    headers.get('cf-connecting-ip') ?? '',
    headers.get('true-client-ip') ?? '',
    headers.get('x-client-ip') ?? '',
  ];

  const candidates = rawCandidates
    .map((candidate) => toCandidate(candidate))
    .filter((candidate): candidate is IpCandidate => candidate !== null)
    .filter((candidate, index, all) => all.findIndex((entry) => entry.value === candidate.value) === index);

  if (!candidates.length) return null;

  return (
    candidates.find((candidate) => candidate.isIpv4 && !candidate.isPrivate)?.value
    ?? candidates.find((candidate) => !candidate.isPrivate)?.value
    ?? candidates.find((candidate) => candidate.isIpv4)?.value
    ?? candidates[0]?.value
    ?? null
  );
}

export function extractClientIp(request: Request): string | null {
  return selectClientIpFromHeaders(request.headers);
}
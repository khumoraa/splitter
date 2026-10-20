/**
 * Pure helpers for editing a .env file without touching anything but one variable.
 */

/** Set KEY=value, replacing only the first existing KEY line (comments, blank lines and other variables stay as they are). */
export function upsertEnvVar(content, key, value) {
  const line = `${key}=${value}`;
  const lines = content === '' ? [] : content.split('\n');
  const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
  const i = lines.findIndex((l) => re.test(l));
  if (i >= 0) {
    lines[i] = line;
  } else {
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push(line);
  }
  return lines.join('\n').replace(/\n*$/, '\n');
}

/** Read KEY from .env content (no quotes handling beyond trimming), or undefined. */
export function readEnvVar(content, key) {
  const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.*)$`, 'm');
  const m = content.match(re);
  return m ? m[1].trim() : undefined;
}

/** First private IPv4 of a physical-looking interface from os.networkInterfaces() output. */
export function pickLanIp(interfaces) {
  const isPrivate = (a) => /^10\./.test(a) || /^192\.168\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a);
  const names = Object.keys(interfaces).sort((a, b) => {
    const rank = (n) => (/^(en|eth|wlan|wl)/i.test(n) ? 0 : 1);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  for (const name of names) {
    for (const info of interfaces[name] ?? []) {
      if (info.family === 'IPv4' && !info.internal && isPrivate(info.address)) return info.address;
    }
  }
  return undefined;
}

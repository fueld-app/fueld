#!/usr/bin/env python3
"""Deploy the marketing site to Netlify via the digest API.

Usage: python3 scripts/deploy-marketing.py

Hard-won lessons (2026-09-13 MIME incident — site served as text/plain):
1. ALWAYS upload with the correct Content-Type per file. Netlify stores what
   you PUT; `application/octet-stream` on HTML makes the browser render the
   page as raw text (and `X-Content-Type-Options: nosniff` prevents sniffing).
2. Declare HTML files at their REAL paths (`/index.html`, `/privacy/index.html`)
   — never strip `index.html`. Pretty URLs (`/`, `/privacy/`) only get
   text/html when the underlying file record ends in .html.
3. If the digest dedup store gets poisoned (digests registered but files
   unreachable / wrong type), new deploys come back `required: 0` and PUTs are
   rejected with 422 "no records matched". Force fresh digests by appending a
   unique marker (e.g. `<!-- r:TIMESTAMP -->`) to the HTML files.
4. Root must be declared `/index.html` (PUT to `/files/index.html`), not `/`.
5. Verify after deploy: `curl -sI https://www.fueld.app/ | grep content-type`
   must be text/html. The Netlify CLI (`npx netlify deploy --dir dist --prod
   --no-build`) also works but can silently skip uploads (`required: 0`) when
   the store is poisoned.
"""
import os, hashlib, json, urllib.request, urllib.error, time, sys

MARKETING_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'apps', 'marketing')
TOKEN_FILE = '/tmp/netlify-token'
SITE_ID = '443cd473-8a58-48c9-9328-bd1cc7484c45'
API = 'https://api.netlify.com/api/v1'

MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
    '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.pdf': 'application/pdf',
}
def mime_for(p):
    return MIME.get(os.path.splitext(p)[1].lower(), 'application/octet-stream')

try:
    token = open(TOKEN_FILE).read().strip()
except FileNotFoundError:
    print("ERROR: No Netlify token at /tmp/netlify-token. Run: npx netlify login")
    sys.exit(1)

os.chdir(MARKETING_DIR)

import subprocess
print("Building…")
# PUBLIC_SITE_URL is REQUIRED — without it canonical/og:url/og:image bake the
# fueld.example.com placeholder, breaking WhatsApp/social link previews.
env = {**os.environ, 'PUBLIC_SITE_URL': 'https://www.fueld.app'}
subprocess.run(['npx', 'astro', 'build'], check=True, capture_output=True, env=env)
print("Build complete.")

# Collect files. HTML gets a unique revision marker so its digest is always
# fresh (avoids the poisoned-dedup-store 422/required:0 trap). Marker is
# HTML-only by design — binary assets (og-card.png, icons) keep stable digests
# so social-preview URLs don't churn.
marker = f"\n<!-- r:{int(time.time())} -->\n".encode()
file_map = {}
for root, dirs, fns in os.walk('dist'):
    for fn in fns:
        p = os.path.join(root, fn)
        rel = '/' + os.path.relpath(p, 'dist').replace(os.sep, '/')
        with open(p, 'rb') as f: body = f.read()
        if rel.endswith('.html'):
            body += marker
        file_map[rel] = {'sha': hashlib.sha1(body).hexdigest(), 'body': body}

digests = {path: info['sha'] for path, info in file_map.items()}
print(f"{len(file_map)} files")

def api(method, path, data=None, headers=None):
    h = {'Authorization': f'Bearer {token}'}
    if headers: h.update(headers)
    r = urllib.request.Request(API + path, data=data, method=method, headers=h)
    return json.loads(urllib.request.urlopen(r).read())

resp = api('POST', f'/sites/{SITE_ID}/deploys',
    data=json.dumps({'files': digests}).encode(),
    headers={'Content-Type': 'application/json'})
dep_id = resp['id']
required = set(resp.get('required', []))
print(f"Deploy: {dep_id} | required: {len(required)} | state: {resp['state']}")

sha_to_path = {info['sha']: path for path, info in file_map.items()}

for sha in required:
    path = sha_to_path.get(sha)
    if not path:
        continue
    url = f'{API}/deploys/{dep_id}/files{path}'
    req = urllib.request.Request(url, data=file_map[path]['body'], method='PUT',
        headers={'Authorization': f'Bearer {token}', 'Content-Type': mime_for(path)})
    try:
        urllib.request.urlopen(req)
        print(f"  uploaded {path} ({mime_for(path).split(';')[0]})")
    except urllib.error.HTTPError as e:
        print(f"  ERROR {path}: {e.code} {e.read()[:100]}")

for i in range(30):
    time.sleep(5)
    st = api('GET', f'/sites/{SITE_ID}/deploys/{dep_id}')
    print(f"  state: {st['state']}")
    if st['state'] in ('ready', 'error'):
        if st.get('error_message'):
            print(f"  error: {st['error_message']}")
        break

# Verify MIME on production — EVERY declared path, not just a spot-check
import urllib.request as ur
time.sleep(10)
failures = []
check_paths = [p for p in file_map if mime_for(p).startswith('text/html')]
check_paths += ['/']  # pretty root serves from /index.html
for p in sorted(set(check_paths)):
    url = f'https://www.fueld.app{p}'
    try:
        with ur.urlopen(url + f'?cb={int(time.time())}') as r:
            ct = r.headers.get('content-type', '')
        status = 'ok' if ct.startswith('text/html') else 'BAD'
        print(f"  {status} {p} -> {ct or '(none)'}")
        if not ct.startswith('text/html'):
            failures.append((p, ct))
    except Exception as e:
        print(f"  {p} -> ERROR {e}")
        failures.append((p, str(e)))
if failures:
    print(f"\n⚠️  {len(failures)} path(s) not serving text/html — deploy broken!")
    sys.exit(2)

print(f"\n✅ Deployed: https://www.fueld.app (deploy {dep_id}) — all HTML paths verified text/html")
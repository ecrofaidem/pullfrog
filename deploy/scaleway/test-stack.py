#!/usr/bin/env python3
"""Check a disposable deployment seeded with the local test webhook secret."""
import hashlib
import hmac
import urllib.error
import urllib.request

public = "http://127.0.0.1:18080"
cases = [
    ("GET", "/", 404),
    ("GET", "/healthz", 404),
    ("GET", "/api/auth/get-session", 404),
    ("GET", "/api/cli/secrets", 404),
    ("POST", "/api/query", 404),
    ("GET", "/webhooks/github", 404),
    ("POST", "/webhooks/github", 401),
    ("POST", "/api/github/installation-token", 401),
    ("GET", "/api/repo/ecrofaidem/test/run-context", 403),
]
for method, path, expected in cases:
    request = urllib.request.Request(
        public + path, method=method, data=b"{}" if method == "POST" else None
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            status = response.status
    except urllib.error.HTTPError as error:
        status = error.code
    assert status == expected, (method, path, status, expected)
    print(method, path, status)

body = b"{}"
signature = "sha256=" + hmac.new(
    b"local-integration-test-only", body, hashlib.sha256
).hexdigest()
request = urllib.request.Request(
    public + "/webhooks/github", data=body,
    headers={"X-Hub-Signature-256": signature, "X-GitHub-Event": "ping"},
)
with urllib.request.urlopen(request, timeout=10) as response:
    assert response.status == 200
    print("Signed webhook accepted")
with urllib.request.urlopen("http://127.0.0.1:13000/sign-in", timeout=10) as response:
    assert response.status == 200
    assert b"GitHub" in response.read()
    print("Private sign-in page rendered")

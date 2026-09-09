# The mitmproxy transport

Four of the seven tools can be pointed at contextlab with an environment
variable. Three cannot:

| Tool | Why |
| :--- | :--- |
| Codex | Rust binary, connects to `chatgpt.com` directly |
| Cline | OAuth traffic routes through `api.cline.bot` |
| OpenCode | Talks to several providers at once, no single base URL |

For those, contextlab runs mitmproxy as a forward proxy and loads
`contextlab_addon.py`, which captures the same records the reverse proxy writes
and POSTs them to the server on `:4041`.

## Requirements

```bash
brew install mitmproxy      # or: pipx install mitmproxy
```

The first run of `mitmdump` creates a CA certificate at
`~/.mitmproxy/mitmproxy-ca-cert.pem`. Every intercepted tool has to trust it.

## Certificate trust — read this before debugging

Three separate mechanisms, and no single environment variable covers them:

- **Python tools** read `REQUESTS_CA_BUNDLE` or `SSL_CERT_FILE`.
- **Node tools ignore `SSL_CERT_FILE`.** They need `NODE_EXTRA_CA_CERTS`.
- **Codex on macOS ignores both.** It uses rustls with the system Keychain, so
  the CA has to be trusted at the OS level or it fails with
  `stream disconnected before headers`.

`buildMitmEnv()` in `@contextlab/core` sets all of the variable-based ones. For
the Keychain, check and fix with:

```bash
security verify-cert -c ~/.mitmproxy/mitmproxy-ca-cert.pem

sudo security add-trusted-cert -d -p ssl -k /Library/Keychains/System.keychain \
  ~/.mitmproxy/mitmproxy-ca-cert.pem
```

`contextlab doctor` runs the check and prints the second command if it fails.

## Keeping the two capture paths in step

`contextlab_addon.py` deliberately duplicates the detection and redaction rules
from `../src/route.js` and `../src/capture.js`. It has to: it is a different
language in a different process. If you change the provider detection order, the
redaction list, or the capture shape in one, change it in the other.

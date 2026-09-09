# @contextlab/proxy

The only part of contextlab that ever sees an API key.

**It has zero external dependencies, and it never will.** That is not a promise, it
is the reason this package exists as its own package: it is short enough that you
can read all of it before you trust it with a credential.

What it does:

1. Accepts a request from your coding tool on `localhost:4040`.
2. Forwards it, unmodified, to the real provider over HTTPS.
3. Streams the response back untouched — SSE included, byte for byte.
4. After the response completes, writes a capture file to
   `~/.contextlab/captures/`.

What it does not do: parse, analyse, tokenize, price, phone home, or keep your key
anywhere but in the memory of the forwarded request.

If you are reviewing this before pointing your key at it, `src/` is the whole story.

# Relay integrations

Before adding Relay protocol configuration or behavior, check the current public Relay packages, SDK exports, and existing tools and services. Inspect how the relevant Relay repositories consume them. Verifying copied values against source does not replace this reuse check.

Prefer the maintained public API over local copies of deployment addresses, message encoders, signing helpers, ABI definitions, or service clients. Keep local mappings only where the shared packages do not provide the required information, and explain the gap in the handoff.

Check the published version, exports, and runtime compatibility before integrating a package. For browser features, load Node-only metadata during the build and expose only the required public fields. Do not serialize RPC credentials or add broad Node polyfills to make a server package work in the browser.

Include package reuse in the implementation audit before publishing a PR. Reusing a package or tool does not expand permission to modify sibling repositories or operate live services.

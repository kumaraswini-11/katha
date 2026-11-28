# ADR-008: Security & Identity Architecture

## Status

Question approved — answer drafted (under review)

## The Question

How should a microservices system handle authentication,
authorization, and trust between services — and which security
models fit which context?

1. **The identity landscape.** Which authentication and
   authorization models exist — centralized identity provider vs.
   embedded auth, OAuth2/OIDC flows, JWT vs. opaque tokens vs.
   sessions, API keys, mutual TLS? What does each optimize for?

2. **Token-based trust.** How do services verify caller identity
   without calling the auth service on every request — JWT/JWKS
   validation, token introspection, cached verification? What are
   the trade-offs between statelessness and revocation agility?

3. **Service-to-service trust.** How do internal calls authenticate
   — mTLS, signed internal tokens, service-mesh identity? Where
   does "zero trust" end and network-perimeter trust begin?

4. **Authorization models.** RBAC vs. ABAC vs. ReBAC vs. policy
   engines — and where should authorization live: at the gateway,
   inside each service, or both? How is authZ kept consistent
   across service boundaries?

5. **Secrets & sensitive data.** How are secrets managed —
   environment variables, dedicated vaults, cloud secret managers —
   rotated, and kept out of code, logs, and error payloads?

---

## Answer

### 1. The identity landscape

Authentication (who are you) and authorization (what may you do)
are separate problems with separate solutions; most systems
delegate authentication to a dedicated **identity provider (IdP)**
and keep authorization distributed.

**Centralized IdP vs. embedded auth.** An IdP — Auth0, Okta,
Microsoft Entra ID, Google, or self-hosted Keycloak — owns the
user store, credential verification, MFA, federation to
enterprise IdPs, password reset, and brute-force defenses.
Applications never see passwords; they receive signed tokens.
This concentrates the hardest, most security-critical code in one
audited place. "Embedded" auth — each service storing password
hashes and verifying credentials itself — is almost always the
wrong answer: password handling, MFA, credential-stuffing
defense, and session management are famously easy to get wrong,
which is why NIST publishes dedicated digital-identity
guidelines. The exception is machine-to-machine auth, where
there is no human user to authenticate.

**OAuth2 vs. OIDC.** OAuth 2.0 (RFC 6749) is an _authorization_
framework: it lets a client obtain delegated access to a resource
without sharing the user's credentials. Its grants cover the real
cases — authorization code + PKCE for browser and mobile apps,
client credentials for service-to-service, device code for
TVs/CLIs, refresh tokens for session continuity. The subtle point:
OAuth2 alone does not prove _who_ the user is — a client-credentials
token has no user at all. **OpenID Connect** adds the identity
layer on top: an `id_token` (a JWT carrying `iss`, `sub`, `aud`,
`exp`, `nonce`, and profile claims), a standard `userinfo`
endpoint, and a discovery document at
`/.well-known/openid-configuration` so clients can find an
operator's endpoints automatically. Flow in practice: the app
redirects to the IdP, the user authenticates there, the app
receives tokens back, verifies the ID token's signature against
the IdP's published keys, and knows who the user is.

**Token formats.** Three families, three trade-offs:

- **JWT (RFC 7519)** — `header.payload.signature`, each part
  base64url. Signed with HS256 (symmetric: issuer and verifier
  share a secret) or RS256/ES256 (asymmetric: issuer signs with a
  private key, anyone verifies with the public key published in
  the JWKS endpoint — this asymmetry is what makes distributed
  verification possible). Self-contained and verifiable offline —
  no auth-server call per request — but it cannot be revoked
  before `exp`, it is relatively large (typically 1–4 KB), and
  its claims are readable by anyone holding it unless encrypted.
- **Opaque token** — a random string referencing server-side
  state. Validated by calling the auth server's introspection
  endpoint (RFC 7662), which returns `active` plus claims.
  Instantly revocable, tiny on the wire — but every validation is
  a network call (or a cache entry), so the auth server sits on
  your critical path.
- **Session cookie** — a server-side session ID in a cookie.
  The classic monolith pattern; in a BFF architecture the session
  lives at the edge and services receive tokens.

**API keys** are static secrets identifying a client or
application — simple, ubiquitous for low-risk machine access,
but no expiry semantics and painful rotation; a leaked key is
valid until someone notices. **mTLS** authenticates at the TLS
layer: the client presents an X.509 certificate during the
handshake and the server verifies it against a CA — mutual
authentication plus encryption in one mechanism, with the cert's
identity (often a SPIFFE ID) usable as the caller's name.
**SAML 2.0** is the older XML-based enterprise SSO federation
standard — clunkier than OIDC but still entrenched in enterprise
IdPs.

### 2. Token-based trust

The central question: how does a service verify "this request is
from user X" without calling the auth server every time?

**Stateless JWT validation** is the standard answer:

1. The client sends `Authorization: Bearer <jwt>`.
2. The service parses the header to get `alg` and `kid` (key ID).
3. It fetches the IdP's JWKS (public keys) — cached, with a
   refetch triggered by an unknown `kid` to handle key rotation.
4. It verifies the signature over `header.payload` (RS256 = RSA
   signature; ES256 = ECDSA P-256).
5. It validates claims: `exp` and `nbf` (with small clock-skew
   leeway), `iss` (right issuer), `aud` (this service is an
   intended audience — without this check, a token minted for
   service A replays against service B).
6. It authorizes from claims — roles, scopes, tenant — or fetches
   fresh attributes for sensitive decisions.

No auth-server call means an IdP outage does not stop service
authentication; the JWKS fetch happens rarely and is cacheable.

**The trade-off is statelessness vs. revocation agility.** A JWT
cannot be revoked — it is valid until `exp`. The mitigations:

- **Short-lived access tokens** (5–15 minutes) plus rotating
  refresh tokens: compromise windows shrink to minutes, and the
  refresh flow can check revocation state.
- **Introspection with caching** (RFC 7662): POST the token,
  get `active` + claims — instant revocation and live claims, at
  the cost of an auth-server dependency and latency (cache
  introspection results briefly, keyed by token hash, TTL shorter
  than the token's life).
- **Sender-constrained tokens:** mTLS-bound tokens (RFC 8705)
  or DPoP (RFC 9449) tie the token to a client-held key, so a
  stolen token is useless without the key.
- **Denylist:** possible, but reintroduces the state you were
  avoiding — usually only worth it for high-risk sessions.

**Implementation failure modes worth naming:** `alg: none`
acceptance (always pin allowed algorithms); algorithm confusion
(treating an RSA public key as an HMAC secret to forge HS256
tokens — enforce an alg allowlist); `kid` injection (a hostile
key ID becoming a path in the JWKS fetch URL — validate it); a
missing `aud` check enabling cross-service replay; clock skew
without leeway causing spurious expirations; and oversized tokens
breaking proxies with header limits.

### 3. Service-to-service trust

Once a request crosses a service boundary, "who is calling" needs
a workload-level answer, and the options stack:

- **mTLS everywhere.** Every service holds a certificate; the TLS
  handshake authenticates both ends and encrypts the channel in
  one pass. Identity lives in the certificate — conventionally a
  SPIFFE ID (`spiffe://trust-domain/service`) in a SAN. The cost
  is certificate lifecycle management, amortized by session
  resumption and TLS 1.3.
- **SPIFFE/SPIRE** automate exactly this: SPIRE agents attest
  each workload's identity (via node identity + workload
  selectors) and issue short-lived SVIDs — X.509 certs or JWTs —
  rotated automatically. It turns "how do I prove this pod is the
  payments service" into infrastructure, not application code.
  Istio and other meshes integrate with it.
- **Signed internal tokens.** An internal issuer (STS, Vault,
  the IdP itself) mints short-lived JWTs carrying service claims;
  each service verifies locally. Simpler than mTLS — no
  per-connection cert state — but a leaked token can be replayed
  unless it is sender-constrained or single-use.
- **Service mesh.** Sidecar proxies (Envoy) terminate mTLS on
  every hop: the application sends plaintext to `localhost`, the
  mesh handles identity, encryption, retries, and telemetry. The
  control plane distributes certificates and authorization
  policies. This moves trust into the platform layer — powerful,
  but it adds a critical dependency, per-hop latency, and an
  operational surface of its own.

**Where zero trust ends and perimeter begins.** NIST SP 800-207
defines zero trust as: no implicit trust based on network
location — authenticate and authorize every request, for users
_and_ workloads. The honest reading for most systems: the
perimeter (VPC boundaries, security groups, edge WAF) remains a
useful first layer against volumetric and opportunistic attack,
but it is not sufficient — the threat model is lateral movement
after one compromise. Zero trust for east-west traffic means
mTLS + workload identity (SPIFFE) + policy-based authorization
(e.g., Envoy ext-authz or OPA). What it does _not_ replace:
edge defenses against DDoS and scanning, and the reality that
some traffic (public web) must cross the perimeter anyway. Most
production systems are hybrid: perimeter at the edge, zero-trust
identity inside.

### 4. Authorization models

Four models, increasing in expressive power and cost:

- **RBAC** — subjects hold roles; roles map to permissions.
  Simple, auditable, easy to reason about; the failure mode is
  role explosion ("admin for region X but only for refunds under
  $500"). Good for coarse gates.
- **ABAC** — the decision is a function of attributes: subject
  attributes (department, clearance), resource attributes
  (owner, classification), environment (time, IP), and the
  action. NIST SP 800-162 standardizes the model. Maximally
  flexible — and maximally hard to debug, since the answer
  depends on attribute freshness and policy complexity.
- **ReBAC** — authorization is a _relationship graph_: tuples
  like `(alice, viewer, document:123)`; a check is a graph
  traversal ("is alice a viewer of this doc, directly or via the
  folder's editors?"). It naturally models ownership,
  org hierarchies, and sharing. Google's Zanzibar paper reports
  trillions of ACLs, millions of authorization checks per second,
  p95 latency under 10 ms, and 99.999% availability over three
  years of production use; SpiceDB and OpenFGA are open-source
  Zanzibar-style implementations.
- **Policy engines** — OPA (Rego) and Cedar externalize
  authorization as a service: the app sends structured input,
  gets allow/deny plus obligations. Policy-as-code is
  unit-testable and centralized; the cost is a runtime dependency
  and per-call latency. Cedar is designed for formal
  verifiability — bounded evaluation you can prove properties
  about.

**Where authorization lives.** The industry-consensus split:

- **At the gateway:** coarse checks — is the caller
  authenticated, does the token carry the required role/scope,
  is this tenant allowed, rate limits. Cheap, centralized, and
  it sheds obvious abuse early. But the gateway lacks resource
  context — it cannot answer "does _this_ user own _this_
  document."
- **Inside each service (the resource owner):** authoritative.
  Only the service knows the resource's state and ownership, so
  it must enforce "can this identity perform this action on this
  resource _now_." Critically, services must verify identity
  themselves — blindly trusting an `X-User-Id` header injected by
  the gateway is the classic spoofing hole, because any compromised
  workload inside the mesh can forge it. Headers are hints;
  verified tokens are proof.
- **Both — defense in depth.** Gateway for coarse edge policy,
  service for fine resource-level decisions. Authenticate at the
  edge, authorize at the resource.

**Consistency across boundaries** comes from propagating verified
identity — a signed token carrying `sub`, roles, tenant — and
letting each service apply its own authorization against its own
data. Duplicating policy logic across services drifts; centralize
policy in an engine or shared library, and for relationship-heavy
domains consider a Zanzibar-style authorization service —
accepting its runtime dependency and caching decisions
carefully. For sensitive operations, short token TTLs or
step-up authentication (a fresh token for the dangerous action)
keep stale claims from becoming stale permissions.

### 5. Secrets & sensitive data

A spectrum, not a binary choice:

- **Environment variables / config files** — simplest, and fine
  for non-sensitive configuration. For secrets they leak through
  process listings, crash dumps, container inspect, and CI logs.
  Kubernetes Secrets are only base64-encoded — not encrypted by
  default — and readable by anyone who can view the pod spec;
  etcd-level encryption at rest helps but does not change who can
  read the mounted value.
- **Cloud secret managers** — AWS Secrets Manager, Google Secret
  Manager, Azure Key Vault: managed storage with IAM-scoped
  access, versioning, audit logging, replication, and built-in
  rotation (AWS rotates via Lambda; GCP offers rotation
  schedules; all support customer-managed keys). The default
  choice when already on a cloud.
- **Dedicated vaults** — HashiCorp Vault's differentiator is
  _dynamic_ secrets: database credentials generated on demand
  with a TTL and automatically revoked at lease expiry, plus a
  transit encryption engine and audit devices. The cost is
  operating Vault itself (unseal, HA, upgrades).
- **Kubernetes integration** — the External Secrets Operator
  syncs vault/cloud-manager secrets into native K8s Secrets (or
  CSI-mounted volumes) so workloads consume them through familiar
  mounts while the source of truth stays centralized.

**Rotation** should be automated, because manual rotation is
skipped. Secrets should carry TTLs — dynamic credentials expire
by design — and rotation should be zero-downtime: dual-credential
windows or push-based rotation. Know your reload semantics:
environment variables are fixed at process start, so apps that
must pick up rotated DB credentials need fetch-at-use, a sidecar
injector, or connection pools that re-authenticate. cert-manager
covers the TLS-certificate case with short-lived auto-renewed
certs.

**Keeping secrets out of code, logs, and errors** is a
disciplined set of habits:

- **Code:** pre-commit and CI scanning (gitleaks, trufflehog,
  GitHub secret scanning / push protection). Treat any committed
  secret as compromised — rotate it; deleting the line does not
  un-leak it.
- **Logs:** structured logging with explicit allowlists and
  field-level redaction; never log `Authorization` headers,
  tokens, passwords, or PII; give errors correlation IDs for
  traceability without payload leakage; apply redaction again at
  the log-aggregation layer, because the sink sees what the app
  emits.
- **Error payloads:** never echo secrets or internal detail in
  4xx/5xx responses — detail goes to server-side logs, clients
  get stable error codes.
- **In transit and at rest:** TLS everywhere; secrets never in
  URLs (proxies log them); envelope encryption via KMS/HSM for
  data at rest.
- **Classification:** secrets, PII, and plain config deserve
  different controls — know which regulatory regime (GDPR,
  PCI-DSS, HIPAA) applies before choosing storage and retention.

**Bottom line:** delegate human authentication to an IdP behind
OIDC, verify JWTs statelessly with short TTLs and disciplined
claim checks, authenticate workloads with mTLS/SPIFFE (mesh if
you can operate one), authenticate at the edge and authorize at
the resource, and treat every secret as having a TTL — fetched
from a managed store or vault, rotated automatically, and kept
out of code, logs, and error bodies by construction rather than
by vigilance.

### Sources

- [RFC 6749 — OAuth 2.0 (2012)](https://datatracker.ietf.org/doc/html/rfc6749);
  [RFC 7519 — JSON Web Token (2015)](https://datatracker.ietf.org/doc/html/rfc7519);
  [RFC 7517 — JSON Web Key (2015)](https://datatracker.ietf.org/doc/html/rfc7517);
  [RFC 7662 — Token Introspection (2015)](https://datatracker.ietf.org/doc/html/rfc7662);
  [RFC 8705 — OAuth 2.0 mTLS (2020)](https://datatracker.ietf.org/doc/html/rfc8705);
  [RFC 9449 — DPoP (2023)](https://datatracker.ietf.org/doc/html/rfc9449)
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html);
  [OpenID Connect Discovery 1.0](https://openid.net/specs/openid-connect-discovery-1_0.html);
  [OpenID Connect](https://openid.net/connect/);
  [OASIS — SAML 2.0 Core specification](https://docs.oasis-open.org/security/saml/v2.0/saml-core-2.0-os.pdf)
- [NIST SP 800-207 — Zero Trust Architecture (2020)](https://csrc.nist.gov/pubs/sp/800/207/final);
  [NIST SP 800-162 — ABAC guide (2014)](https://csrc.nist.gov/pubs/sp/800/162/final)
- [Pang et al. — "Zanzibar: Google's Consistent, Global Authorization System" (2019)](https://research.google/pubs/zanzibar-googles-consistent-global-authorization-system/);
  [OpenFGA](https://openfga.dev/);
  [SpiceDB](https://github.com/authzed/spicedb);
  [Cedar policy language](https://github.com/cedar-policy/cedar);
  [Open Policy Agent documentation](https://www.openpolicyagent.org/docs/latest/)
- [SPIFFE overview](https://spiffe.io/docs/latest/spiffe-about/overview/);
  [Istio documentation](https://istio.io/latest/docs/)
- [HashiCorp Vault documentation](https://developer.hashicorp.com/vault/docs);
  [AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html);
  [Google Cloud Secret Manager](https://cloud.google.com/secret-manager/docs/overview);
  [Kubernetes — Secrets](https://kubernetes.io/docs/concepts/configuration/secret/);
  [External Secrets Operator](https://external-secrets.io/);
  [gitleaks](https://github.com/gitleaks/gitleaks)

# Threat model (living document)

Security-sensitive PRs (crypto, auth, sync, sharing) append a note here. T192 finalises it.

## Assets

- Financial content (names, notes, amounts, dates) and its keys: Secret Key, password, AUK, Fold keys, device keys.
- Account metadata held by the relay: email (discoverability optional), device list, routing metadata, ciphertext sizes and timing.

## Trust boundaries

- User device (Core Worker) ⟷ UI thread: secrets live only in the worker.
- Device ⟷ relay: the relay is untrusted for confidentiality and integrity of content; it is trusted only for availability.
- Static host ⟷ browser: the web app's code is delivered by the host (see residual risks).

## Residual risks (documented, accepted)

1. **JavaScript cannot guarantee memory erasure.** `SecretBuf.wipe()` is best effort; GC, JIT and swap may retain copies.
2. **Web code delivery is trusted.** A compromised static host can serve malicious code. Mitigations: strict CSP, SRI, no third-party scripts, reproducible builds with published hashes; the Tauri shell removes this risk post-v1.

## PR notes

<!-- Append: date, PR, asset/boundary touched, attacker capability considered, mitigation. -->

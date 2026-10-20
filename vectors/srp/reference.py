#!/usr/bin/env python3
"""Independent reference for the SRP-6a exchange of ARCH 6 (4096-bit group, SHA-256, x from 2SKD).

Standard library only: Python's pow() and hashlib share no code with the TypeScript client (WASM crypto-bigint) or the
server (OpenSSL). Run `python3 vectors/srp/reference.py` to regenerate srp.json; the TypeScript tests read the JSON.
The group prime is recomputed from the RFC 3526 formula here, so a typo anywhere else cannot hide.
"""
import hashlib, json, os, random

def pi_scaled(bits):
    guard = 64
    one = 1 << (bits + guard)
    def atan_inv(x):
        term = one // x; total = term; x2 = x * x; n = 1
        while term:
            term //= x2
            total += (-1 if n % 2 else 1) * (term // (2 * n + 1)); n += 1
        return total
    return (16 * atan_inv(5) - 4 * atan_inv(239)) >> guard

N = 2**4096 - 2**4032 - 1 + 2**64 * (pi_scaled(3966) + 240904)
g = 2
SIZE = 512
H = lambda *parts: hashlib.sha256(b"".join(parts)).digest()
pad = lambda v: v.to_bytes(SIZE, "big")
integer = lambda b: int.from_bytes(b, "big")
xor = lambda p, q: bytes(a ^ b for a, b in zip(p, q))
k = integer(H(pad(N), pad(g)))

def verifier(x): return pow(g, x, N)

def client_server(account_id, auth_salt, x, a, b):
    v = verifier(x)
    A = pow(g, a, N)
    B = (k * v + pow(g, b, N)) % N
    u = integer(H(pad(A), pad(B)))
    S_client = pow((B - k * pow(g, x, N)) % N, a + u * x, N)
    S_server = pow(A * pow(v, u, N) % N, b, N)
    assert S_client == S_server
    K = H(pad(S_client))
    M1 = H(xor(H(pad(N)), H(pad(g))), H(account_id.encode()), auth_salt, pad(A), pad(B), K)
    M2 = H(pad(A), M1, K)
    return dict(v=v, A=A, B=B, u=u, S=S_client, K=K, M1=M1, M2=M2)

def hexed(d): return {key: (pad(val).hex() if isinstance(val, int) else val.hex()) for key, val in d.items()}

here = os.path.dirname(os.path.abspath(__file__))
two_skd = json.load(open(os.path.join(here, "..", "2skd", "2skd.json")))
srp_case = next(c for c in two_skd["cases"] if c["purpose"] == "srp")
account_id = two_skd["inputs"]["account_id"]
auth_salt = bytes.fromhex(two_skd["inputs"]["salt16"])
x = integer(bytes.fromhex(srp_case["k_p"]))

fixed_a = int("0123456789abcdef" * 4, 16)
fixed_b = int("fedcba9876543210" * 4, 16)
vector2 = client_server(account_id, auth_salt, x, fixed_a, fixed_b)

rng = random.Random(0x5250)
random_exchanges = []
for _ in range(100):
    acct = "".join(rng.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
    salt = bytes(rng.getrandbits(8) for _ in range(16))
    rx = rng.getrandbits(256) or 1
    ra = rng.getrandbits(256) or 1
    rb = rng.getrandbits(256) or 1
    out = hexed(client_server(acct, salt, rx, ra, rb))
    out.update(account_id=acct, auth_salt=salt.hex(), x=pad(rx).hex(), a=pad(ra).hex(), b=pad(rb).hex())
    random_exchanges.append(out)

json.dump({
    "source": "independent implementation: Python standard library (pow, hashlib); see reference.py",
    "group": {"N": pad(N).hex(), "g": 2, "k": pad(k).hex()},
    "verifier": {"account_id": account_id, "auth_salt": auth_salt.hex(), "k_p_srp": srp_case["k_p"], "x": pad(x).hex(), "v": pad(verifier(x)).hex()},
    "exchange": {**hexed(vector2), "account_id": account_id, "auth_salt": auth_salt.hex(), "x": pad(x).hex(), "a": pad(fixed_a).hex(), "b": pad(fixed_b).hex()},
    "random": random_exchanges,
}, open(os.path.join(here, "srp.json"), "w"), indent=1)
print("srp.json written")

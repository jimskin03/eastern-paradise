import hashlib
import hmac
import random
import secrets
from typing import Optional


def generate_secret_seed(byte_count: int = 32) -> str:
    """Generates a cryptographically strong hex seed string."""
    return secrets.token_hex(byte_count)


def derive_seed_hash(secret_seed: str) -> str:
    """
    Computes a public SHA-256 hash of the secret seed.
    This public hash is safe to display to clients while keeping the actual seed hidden.
    """
    return hashlib.sha256(secret_seed.encode("utf-8")).hexdigest()


def derive_subseed(secret_seed: str, domain: str) -> str:
    """
    Derives an isolated deterministic subkey for a specific puzzle component or round.
    Uses HMAC-SHA256.
    """
    h = hmac.new(secret_seed.encode("utf-8"), domain.encode("utf-8"), hashlib.sha256)
    return h.hexdigest()


def create_prng(seed: str) -> random.Random:
    """
    Creates a reproducible PRNG seeded with an integer representation of the hex seed.
    """
    # Use first 16 hex chars (64 bits) as integer seed for standard Random
    seed_int = int(hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16], 16)
    return random.Random(seed_int)

#!/usr/bin/env python3
"""Generate a bcrypt hash for your shared portal password.

Usage:
    python scripts/hash_password.py yourpassword

Copy the output into APP_PASSWORD_HASH in your .env file.
"""
import sys
from passlib.context import CryptContext

if len(sys.argv) < 2:
    print("Usage: python scripts/hash_password.py yourpassword")
    sys.exit(1)

pwd = sys.argv[1]
hashed = CryptContext(schemes=["bcrypt"]).hash(pwd)
print(f"\nAPP_PASSWORD_HASH={hashed}\n")
print("Copy this line into your .env file.")

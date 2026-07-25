import secrets

for name in ["PRIVATE_KEY_ALICE", "PRIVATE_KEY_BOB", "PRIVATE_KEY_DEPLOYER"]:
    key = "0x" + secrets.token_hex(32)
    print(f"{name}={key}")

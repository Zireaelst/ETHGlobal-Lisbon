import secrets

for name in ["ALICE_PRIVATE_KEY", "BOB_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"]:
    key = "0x" + secrets.token_hex(32)
    print(f"{name}={key}")

// PaymentBackend interface — swappable behind base-stealth / hedera-x402.
export interface PaymentBackend {
  pay(params: { to: string; amount: bigint; intentHash: string }): Promise<{ txRef: string }>;
  verify(txRef: string): Promise<boolean>;
}

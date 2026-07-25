// PaymentBackend — one interface, two rails (BUILD-PLAN P4-A).
//
// Three phases, mapping exactly onto x402's verify/settle split:
//
//   quote()      Bob's 402 response — the price and where the payment goes
//   authorize()  Alice signs; NO MONEY MOVES
//   settle()     money moves, AFTER JobVerified
//
// The reason for the split is the demo's single strongest sentence: on the fraud run
// `JobVerified` never happens, so `settle()` is NEVER CALLED. "The payment never settled."
//
// We do not leave that rule to convention: before settlement `assertJobVerified` reads the
// chain and confirms that the transaction REALLY emitted `JobVerified` for this
// `intentHash`. Backends are obliged to call it (the gate tests this).
//
// The privacy difference is deliberate and written down in roadmap v3 §07: stealth
// recipient-privacy is an EVM construction and does not fit Hedera's account model. The Base
// run proves privacy, the Hedera run proves AUTONOMY. Two separate proofs, not one
// compromised.

export type PaymentRail = 'base-stealth' | 'hedera-x402';

export interface QuoteRequest {
  /** The job the payment is bound to. */
  intentHash: string;
  /** Smallest unit (USDC 6 decimals, HBAR tinybars). */
  amount: string;
  /** The recipient's registered identity — on Base a FRESH stealth address is derived from it. */
  recipient: string;
}

export interface PaymentQuote {
  rail: PaymentRail;
  intentHash: string;
  amount: string;
  asset: string;
  decimals: number;
  /**
   * Where the payment goes.
   * Base: a FRESH stealth address per job — unlinkable to the recipient's registered identity.
   * Hedera: a plain account id — NO recipient privacy, and that is deliberate.
   */
  payTo: string;
  /** The HTTP 402 body, carryable over the wire as-is. */
  http402: unknown;
  expiresAt: number;
}

export interface AuthProof {
  rail: PaymentRail;
  intentHash: string;
  payTo: string;
  amount: string;
  /** A signed but UNSUBMITTED authorisation. At this point the money is still Alice's. */
  payload: unknown;
}

export interface Receipt {
  rail: PaymentRail;
  intentHash: string;
  /** Chain-specific transaction reference. */
  txRef: string;
  explorerUrl: string;
  settledAt: number;
  /** Which JobVerified it settled against — the anchor of the ORDERING proof. */
  jobVerifiedTx: string;
  /** JobVerified's block; settlement must come AFTER it. */
  jobVerifiedBlock?: number;
}

/** Bob's decision on whether to accept the authorisation. */
export interface AuthorizationCheck {
  ok: boolean;
  reason?: string;
}

export interface PaymentBackend {
  readonly rail: PaymentRail;
  quote(request: QuoteRequest): Promise<PaymentQuote>;
  /** Alice authorises — no money moves. */
  authorize(quote: PaymentQuote): Promise<AuthProof>;
  /**
   * The BOB side: does this incoming authorisation really answer MY 402?
   *
   * Runs BEFORE the work is done. Amount, recipient and signature are checked; the money
   * still does not move. This is the gate that stops a stranger getting free work.
   */
  verifyAuthorization(proof: AuthProof, expected: { amount: string; intentHash: string }): Promise<AuthorizationCheck>;
  /**
   * Move the money. `jobVerifiedTx` is MANDATORY and is verified.
   * @throws SettlementNotAuthorizedError when the job was not verified
   */
  settle(proof: AuthProof, jobVerifiedTx: string): Promise<Receipt>;
  /** Independently verify the receipt against the chain. */
  verify(receipt: Receipt): Promise<boolean>;
}

/** Thrown when settlement is attempted for a job that was not verified. */
export class SettlementNotAuthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettlementNotAuthorizedError';
  }
}

export * from './guard.js';
export * from './signer/hedera-signer.js';
export * from './hcs-timeline.js';
export * from './stealth.js';

import styles from "./CtaFooter.module.css";

export default function CtaFooter() {
  return (
    <footer className={`section ${styles.footer}`}>
      <div className={styles.ctas}>
        <a href="#" className={styles.primary}>
          Explore the repo
        </a>
      </div>
      <p className={styles.boundaries}>
        This is feedback anchored to paid, verified jobs — not Sybil-proof
        reputation. The binding catches task substitution and input
        tampering, not all prompt injection. Signatures are verified
        on-chain; enclave attestation is checked off-chain at setup.
      </p>
      <div className={styles.marks}>0G · The Graph · Hedera</div>
    </footer>
  );
}

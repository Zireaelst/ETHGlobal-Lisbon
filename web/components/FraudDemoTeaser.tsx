import styles from "./FraudDemoTeaser.module.css";

export default function FraudDemoTeaser() {
  return (
    <section className={`section ${styles.section}`}>
      <div className={styles.frame}>
        <span className={styles.tag}>Coming soon</span>
        <p className={styles.body}>
          A single flag makes Bob answer a different job. The contract
          catches the mismatch and rejects it — live, on-chain.
        </p>
      </div>
    </section>
  );
}

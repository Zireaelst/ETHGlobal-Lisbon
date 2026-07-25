import styles from "./ThesisSection.module.css";

export default function ThesisSection() {
  return (
    <section id="thesis" className={`section ${styles.thesis}`}>
      <div className={styles.inner}>
        <div className={styles.eyebrow}>The problem</div>
        <p className={styles.lead}>
          Payment, execution and reputation are each solved for agents, but
          nothing connects them.
        </p>
        <p className={styles.body}>
          We carry one signed intent hash from payment, through the enclave,
          to reputation — <em>intent-bound verification</em>.
        </p>
      </div>
    </section>
  );
}

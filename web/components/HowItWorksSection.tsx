import styles from "./HowItWorksSection.module.css";

const STEPS = [
  {
    n: "01",
    title: "Discover",
    body: "Alice finds Bob through the public ERC-8004 registry — skill, endpoint, and encryption pubkey, no prior relationship required.",
  },
  {
    n: "02",
    title: "Encrypt & pay",
    body: "The brief and data are ECIES-encrypted to Bob's pubkey; Alice signs an EIP-712 intent hash and pays over x402.",
  },
  {
    n: "03",
    title: "Verify",
    body: "Bob's Tapp recomputes the intent hash inside a TEE, calls 0G Sealed Inference, and signs the match. Verifier.sol checks both signatures before settlement releases.",
  },
];

export default function HowItWorksSection() {
  return (
    <section id="how-it-works" className={`section ${styles.section}`}>
      <div className={styles.eyebrow}>How it works</div>
      <ol className={styles.steps}>
        {STEPS.map((step) => (
          <li key={step.n} className={styles.step}>
            <span className={styles.number}>{step.n}</span>
            <h3 className={styles.title}>{step.title}</h3>
            <p className={styles.body}>{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

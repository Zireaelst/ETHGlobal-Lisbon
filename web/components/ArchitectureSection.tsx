import styles from "./ArchitectureSection.module.css";

const NODES = [
  { label: "Alice-agent", detail: "discovers · signs intent · pays" },
  { label: "Bob's Tapp (TEE #1)", detail: "recomputes hash · checks match" },
  { label: "0G Sealed Inference (TEE #2)", detail: "runs the model" },
  { label: "Verifier.sol", detail: "checks both signatures on-chain" },
];

export default function ArchitectureSection() {
  return (
    <section id="architecture" className={`section ${styles.section}`}>
      <div className={styles.eyebrow}>Architecture</div>
      <div className={styles.diagram}>
        {NODES.map((node, i) => (
          <div className={styles.nodeWrap} key={node.label}>
            <div className={styles.node}>
              <div className={styles.nodeLabel}>{node.label}</div>
              <div className={styles.nodeDetail}>{node.detail}</div>
            </div>
            {i < NODES.length - 1 && (
              <div className={styles.arrow} aria-hidden="true" />
            )}
          </div>
        ))}
      </div>
      <p className={styles.legend}>
        Base = the verdict · Hedera = the timeline · The Graph = the read
        layer · 0G = the compute.
      </p>
    </section>
  );
}

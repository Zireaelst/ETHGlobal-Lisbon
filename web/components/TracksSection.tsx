import styles from "./TracksSection.module.css";

const TRACKS = [
  {
    name: "0G",
    detail:
      "Sealed Inference — the model runs inside a TeeML TEE via @0gfoundation/0g-compute-ts-sdk; output is signed by the enclave.",
  },
  {
    name: "The Graph",
    detail:
      "ERC-8004 registry index + JobVerified verified-delivery count, forked from the agent0lab subgraph and deployed live to Subgraph Studio.",
  },
  {
    name: "Hedera",
    detail:
      "@x402/hedera exact-scheme payment via the blocky402 testnet facilitator, settled after verification; HCS records the off-chain timeline as commitments.",
  },
];

export default function TracksSection() {
  return (
    <section id="tracks" className={`section ${styles.section}`}>
      <div className={styles.eyebrow}>Tracks</div>
      <div className={styles.cards}>
        {TRACKS.map((track) => (
          <div className={styles.card} key={track.name}>
            <div className={styles.cardTitle}>{track.name}</div>
            <p className={styles.cardBody}>{track.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

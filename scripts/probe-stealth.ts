// scripts/probe-stealth.ts — verify the ERC-5564 derivation maths (no network access).
import { ethers } from 'ethers';
import {
  checkAnnouncement,
  computeStealthPrivateKey,
  createStealthKeys,
  deriveStealthPayment,
} from '../packages/payment/src/stealth.js';

const bob = createStealthKeys(
  ethers.keccak256(ethers.toUtf8Bytes('bob/spending')),
  ethers.keccak256(ethers.toUtf8Bytes('bob/viewing')),
);
console.log('meta-adres uzunluk:', bob.metaAddress.length, '·', `${bob.metaAddress.slice(0, 34)}…`);

const eph = ethers.keccak256(ethers.toUtf8Bytes('alice/ephemeral/1'));
const pay = deriveStealthPayment(bob.metaAddress, eph);
console.log('Alice derived  :', pay.stealthAddress, '· viewTag', pay.viewTag);

const found = checkAnnouncement(bob, pay.ephemeralPublicKey, pay.viewTag);
console.log('Bob buldu      :', found?.stealthAddress);
console.log('MATCHED        :', found?.stealthAddress === pay.stealthAddress ? 'YES' : 'NO');

const sk = computeStealthPrivateKey(bob, pay.ephemeralPublicKey);
const addrFromKey = new ethers.Wallet(sk).address;
console.log('anahtardan adres:', addrFromKey);
console.log('SPENDABLE      :', addrFromKey === pay.stealthAddress ? 'YES' : 'NO');

console.log(
  'wrong viewTag filtered out:',
  checkAnnouncement(bob, pay.ephemeralPublicKey, (pay.viewTag + 1) % 256) === null ? 'EVET' : 'HAYIR',
);

const stranger = createStealthKeys(
  ethers.keccak256(ethers.toUtf8Bytes('stranger/spending')),
  ethers.keccak256(ethers.toUtf8Bytes('stranger/viewing')),
);
const strangerPay = deriveStealthPayment(stranger.metaAddress, eph);
const shouldNotMatch = checkAnnouncement(bob, strangerPay.ephemeralPublicKey);
console.log(
  'did someone else\'s payment resolve to us:',
  shouldNotMatch?.stealthAddress === strangerPay.stealthAddress ? 'YES (BUG!)' : 'no (correct)',
);

// Same meta-address + a DIFFERENT ephemeral → a different address (no linkage from reuse)
const pay2 = deriveStealthPayment(bob.metaAddress, ethers.keccak256(ethers.toUtf8Bytes('alice/ephemeral/2')));
console.log('second payment has a different address:', pay2.stealthAddress !== pay.stealthAddress ? 'YES' : 'NO');

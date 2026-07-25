// scripts/probe-stealth.ts — ERC-5564 türetme matematiğini doğrula (ağa çıkmaz).
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
console.log('Alice türetti  :', pay.stealthAddress, '· viewTag', pay.viewTag);

const found = checkAnnouncement(bob, pay.ephemeralPublicKey, pay.viewTag);
console.log('Bob buldu      :', found?.stealthAddress);
console.log('EŞLEŞTİ        :', found?.stealthAddress === pay.stealthAddress ? 'EVET' : 'HAYIR');

const sk = computeStealthPrivateKey(bob, pay.ephemeralPublicKey);
const addrFromKey = new ethers.Wallet(sk).address;
console.log('anahtardan adres:', addrFromKey);
console.log('HARCANABİLİR   :', addrFromKey === pay.stealthAddress ? 'EVET' : 'HAYIR');

console.log(
  'yanlış viewTag elendi:',
  checkAnnouncement(bob, pay.ephemeralPublicKey, (pay.viewTag + 1) % 256) === null ? 'EVET' : 'HAYIR',
);

const stranger = createStealthKeys(
  ethers.keccak256(ethers.toUtf8Bytes('stranger/spending')),
  ethers.keccak256(ethers.toUtf8Bytes('stranger/viewing')),
);
const strangerPay = deriveStealthPayment(stranger.metaAddress, eph);
const shouldNotMatch = checkAnnouncement(bob, strangerPay.ephemeralPublicKey);
console.log(
  'başkasının ödemesi bize çıktı mı:',
  shouldNotMatch?.stealthAddress === strangerPay.stealthAddress ? 'EVET (HATA!)' : 'hayır (doğru)',
);

// Aynı meta-adres + FARKLI ephemeral → farklı adres (tekrar kullanım bağlantı yaratmaz)
const pay2 = deriveStealthPayment(bob.metaAddress, ethers.keccak256(ethers.toUtf8Bytes('alice/ephemeral/2')));
console.log('ikinci ödeme farklı adres:', pay2.stealthAddress !== pay.stealthAddress ? 'EVET' : 'HAYIR');

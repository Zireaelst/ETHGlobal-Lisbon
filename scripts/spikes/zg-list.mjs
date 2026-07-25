import { ethers } from 'ethers';
import { createZGComputeNetworkBroker } from '@0gfoundation/0g-compute-ts-sdk';
import fs from 'fs';

const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1).split('#')[0].trim()];}));

const provider = new ethers.JsonRpcProvider(env.OG_RPC_URL);
const wallet = new ethers.Wallet(env.PRIVATE_KEY_ALICE, provider);
const broker = await createZGComputeNetworkBroker(wallet);
const services = await broker.inference.listService();
console.log(JSON.stringify(services, (k,v) => typeof v === 'bigint' ? v.toString() : v, 2));

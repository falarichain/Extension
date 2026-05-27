import { ethers } from 'ethers';
import { signTransactionHash } from './crypto';

/**
 * Sign a bridge_out request matching the Go bridgeOutSigningPayload.
 * Field order must match exactly: chain_id, sender, recipient, target_chain_id, amount, fee, nonce.
 */
export async function signBridgeOut(
  privateKey: string,
  params: {
    chainId: string;
    sender: string;
    recipient: string;
    targetChainId: string;
    amount: number;
    fee: number;
    nonce: number;
  },
): Promise<{ signature: string; publicKey: string }> {
  const payload = {
    chain_id: params.chainId,
    sender: params.sender,
    recipient: params.recipient,
    target_chain_id: params.targetChainId,
    amount: params.amount,
    fee: params.fee,
    nonce: params.nonce,
  };

  const jsonStr = JSON.stringify(payload);
  const hash = ethers.toUtf8Bytes(jsonStr);
  const hashBytes = new Uint8Array(ethers.getBytes(ethers.keccak256(hash)));

  const signature = await signTransactionHash(privateKey, hashBytes);

  const wallet = new ethers.Wallet(privateKey);
  const publicKey = wallet.signingKey.publicKey;

  return { signature, publicKey };
}

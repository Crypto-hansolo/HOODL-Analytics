import { CHAIN } from '../config'
import { truncateAddress } from '../lib/format'

export function AddressLink({ address, kind = 'address', chars = 5 }: { address: string; kind?: 'address' | 'tx'; chars?: number }) {
  const href = `${CHAIN.explorerUrl}/${kind}/${address}`
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="addr-link mono">
      {truncateAddress(address, chars)}
    </a>
  )
}

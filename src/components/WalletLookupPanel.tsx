import { useState } from 'react'
import type { FormEvent } from 'react'
import { CHAIN } from '../config'
import { useWalletLookup } from '../lib/hooks'
import { formatUnits, isValidAddress } from '../lib/format'
import { SectionCard } from './SectionCard'
import { SourceBadge } from './SourceBadge'
import { AddressLink } from './AddressLink'
import { Callout } from './Callout'
import { LoadingBlock, StateBlock, UnavailableBlock } from './StateBlock'

interface Props {
  tokenDecimals: number | null
  tokenSymbol: string | null
}

export function WalletLookupPanel({ tokenDecimals, tokenSymbol }: Props) {
  const [input, setInput] = useState('')
  const [address, setAddress] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const { rpcState, blockscoutState } = useWalletLookup(address)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = input.trim()
    if (!isValidAddress(trimmed)) {
      setFormError('Enter a valid 0x… address (42 hex characters).')
      return
    }
    setFormError(null)
    setAddress(trimmed)
  }

  return (
    <SectionCard
      title="Wallet Lookup"
      description="Direct read-only RPC + Blockscout lookup for any address on Robinhood Chain."
    >
      <div className="lookup-panel">
        <form className="wallet-lookup" onSubmit={handleSubmit}>
          <input
            className="mono"
            placeholder="0x…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            aria-label="Wallet address"
          />
          <button type="submit" className="btn">
            Look up
          </button>
        </form>

        {formError && <Callout kind="warning">{formError}</Callout>}

        {!address && !formError && (
          <StateBlock
            icon="🔍"
            title="No address looked up yet"
            description="Enter an address above to fetch its live HOODL balance, native balance, and transaction count directly from the chain."
          />
        )}

        {address && rpcState.status === 'loading' && !rpcState.data && <LoadingBlock label="Querying RPC…" />}
        {address && rpcState.status === 'unavailable' && <UnavailableBlock error={rpcState.error} />}

        {address && rpcState.data && (
          <>
            <div className="lookup-result-grid">
              <div className="result-tile">
                <div className="result-tile__label">
                  <span>Address</span>
                </div>
                <div className="result-tile__value mono">
                  <AddressLink address={rpcState.data.address} chars={6} />
                </div>
              </div>
              <div className="result-tile">
                <div className="result-tile__label">
                  <span>HOODL Balance</span>
                  <SourceBadge kind="rpc" />
                </div>
                <div className="result-tile__value">
                  {tokenDecimals != null
                    ? `${formatUnits(rpcState.data.hoodlBalance, tokenDecimals)} ${tokenSymbol ?? ''}`
                    : '—'}
                </div>
              </div>
              <div className="result-tile">
                <div className="result-tile__label">
                  <span>Native Balance</span>
                  <SourceBadge kind="rpc" />
                </div>
                <div className="result-tile__value">{formatUnits(rpcState.data.nativeBalanceWei, 18)}</div>
              </div>
              <div className="result-tile">
                <div className="result-tile__label">
                  <span>Tx Count</span>
                  <SourceBadge kind="rpc" />
                </div>
                <div className="result-tile__value">{rpcState.data.transactionCount.toLocaleString('en-US')}</div>
              </div>
              <div className="result-tile">
                <div className="result-tile__label">
                  <span>Contract?</span>
                  {blockscoutState.status === 'success' ? <SourceBadge kind="blockscout" /> : <SourceBadge kind="unavailable" />}
                </div>
                <div className="result-tile__value">
                  {blockscoutState.status === 'success' && blockscoutState.data
                    ? blockscoutState.data.isContract
                      ? 'Yes'
                      : 'No'
                    : '—'}
                </div>
              </div>
              <div className="result-tile">
                <div className="result-tile__label">
                  <span>Verified Source?</span>
                  {blockscoutState.status === 'success' ? <SourceBadge kind="blockscout" /> : <SourceBadge kind="unavailable" />}
                </div>
                <div className="result-tile__value">
                  {blockscoutState.status === 'success' && blockscoutState.data
                    ? blockscoutState.data.isVerified
                      ? 'Yes'
                      : blockscoutState.data.isVerified === false
                        ? 'No'
                        : '—'
                    : '—'}
                </div>
              </div>
            </div>
            <a
              className="btn btn--ghost"
              href={`${CHAIN.explorerUrl}/address/${rpcState.data.address}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ alignSelf: 'flex-start' }}
            >
              Open in Explorer ↗
            </a>
          </>
        )}
      </div>
    </SectionCard>
  )
}

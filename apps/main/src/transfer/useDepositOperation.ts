import { useEffect, useState } from 'react'
import { DEPOSIT_STORAGE_KEY, readDepositOperation, type DepositOperation } from './deposit-operation'

const readSavedDeposit = (): { operation?: DepositOperation; storageError?: string } => {
  try {
    if (!window.localStorage) throw new Error('Enable browser storage to continue.')
    return { operation: readDepositOperation(window.localStorage) }
  } catch (error) {
    return { storageError: error instanceof Error ? error.message : 'Could not load your previous transfer.' }
  }
}

export const useDepositOperation = () => {
  const [saved, setSaved] = useState(readSavedDeposit)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === DEPOSIT_STORAGE_KEY || event.key == null) setSaved(readSavedDeposit())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  return { ...saved, busy, setBusy, onChange: (operation: DepositOperation) => setSaved({ operation }) }
}

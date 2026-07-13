import { useState } from 'react';
import { isStoredSecret, MASKED_SECRET } from '../utils/maskedSecret';

export type SecretReplaceState = {
  isStored: boolean;
  isReplacing: boolean;
  onStartReplace: () => void;
  onCancelReplace: () => void;
};

// Owns the per-field "Stored / Replacing" toggle for a server-masked secret. Pairs with
// `<SecretField>` so callers can spread the returned handlers into the component without
// duplicating start/cancel boilerplate at each site (issue #601 follow-up).
//
// `value` is the current draft value of the secret. `setValue` mutates it (the hook clears it
// on Replace and restores MASKED_SECRET on Cancel). `resetDep` resets the replacing flag when
// it changes — typically the parent's `config` prop, so a save round-trip drops Replace mode.
export const useSecretReplaceState = (
  value: string,
  setValue: (next: string) => void,
  resetDep: unknown,
): SecretReplaceState => {
  const [isReplacing, setIsReplacing] = useState(false);
  // React-recommended "adjust state on prop change" pattern: compare against a stored snapshot
  // during render instead of using a useEffect (avoids an extra render pass + a stale-effect bug
  // window when resetDep flips back-to-back).
  const [resetDepSnapshot, setResetDepSnapshot] = useState(resetDep);
  if (resetDep !== resetDepSnapshot) {
    // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- React-supported prop snapshot adjustment; no updater callback is involved.
    setResetDepSnapshot(resetDep);
    setIsReplacing(false);
  }
  return {
    isStored: isStoredSecret(value),
    isReplacing,
    onStartReplace: () => {
      setValue('');
      setIsReplacing(true);
    },
    onCancelReplace: () => {
      setValue(MASKED_SECRET);
      setIsReplacing(false);
    },
  };
};

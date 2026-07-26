import { useSetAtom } from 'jotai';
import { useCallback } from 'react';
import * as Sentry from '@sentry/react';
import { backupRestoreErrorAtom, backupRestoreProgressAtom } from '$state/backupRestore';
import { useMatrixClient } from './useMatrixClient';
import { useKeyBackupDecryptionKeyCached } from './useKeyBackup';

export const useRestoreBackupOnVerification = () => {
  const setRestoreProgress = useSetAtom(backupRestoreProgressAtom);
  const setRestoreError = useSetAtom(backupRestoreErrorAtom);

  const mx = useMatrixClient();

  useKeyBackupDecryptionKeyCached(
    useCallback(() => {
      const crypto = mx.getCrypto();
      if (!crypto) return;

      setRestoreError(undefined);
      crypto
        .restoreKeyBackup({
          progressCallback(progress) {
            setRestoreProgress(progress);
          },
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          Sentry.addBreadcrumb({
            category: 'crypto',
            message: 'Key backup restore failed',
            level: 'error',
            data: { error: message },
          });
          Sentry.metrics.count('sable.crypto.key_backup_restore_failures', 1);
          setRestoreError(message);
        });
    }, [mx, setRestoreProgress, setRestoreError])
  );
};

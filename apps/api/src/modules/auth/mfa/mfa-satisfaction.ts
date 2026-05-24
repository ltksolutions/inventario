// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * MFA satisfaction helper — ADR-0016 §4 (forceMfa policy interakcia).
 *
 * Určuje, či má user aspoň jeden silný autentifikačný faktor okrem
 * email+hesla: buď TOTP MFA alebo aspoň jeden aktívny passkey.
 *
 * Používa sa v login flow-e pre org-level forceMfa policy check:
 *   if (mfaRequired && !(await userSatisfiesMfa(user, db))) {
 *     // issue mfaSetupToken → forced TOTP setup
 *   }
 *
 * Passkey users s requireMfa=true org prechádzajú login bez forced setup,
 * lebo passkey + biometric je nedokázateľne silnejší faktor než TOTP.
 */

import type { User } from '@inventario/shared-types';
import type { Db } from 'mongodb';

/**
 * Returns true if the user has at least one strong authentication factor
 * beyond email+password: TOTP MFA OR at least one active passkey.
 */
export async function userSatisfiesMfa(user: User & { _id: unknown }, db: Db): Promise<boolean> {
  // TOTP MFA is the most common case — check first (no DB query needed)
  if (user.mfaEnabled === true) return true;

  // passkeyEnabled is a convenience flag — verify at least one active passkey exists
  // (defense in depth: flag could be stale if DB update failed)
  if ((user as Record<string, unknown>)['passkeyEnabled'] !== true) return false;

  const passkeysCol = db.collection('passkeys');
  const count = await passkeysCol.countDocuments({
    userId: String(user._id),
    deletedAt: null,
  });
  return count > 0;
}

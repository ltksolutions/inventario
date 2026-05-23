// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * MembershipsService — business logic pre membership operácie.
 *
 * K16: assertNotLastAdmin()
 *   Transakčne-bezpečná kontrola: zabraňuje situácii, kde by organizácia
 *   ostala bez aktívneho administrátora.
 *
 *   Reuse:
 *     - K15 PATCH /v1/memberships/:id — pri odoberaní ADMIN role
 *     - K15 DELETE /v1/memberships/:id — pri odstráňovaní ADMIN membera
 *     - K17 DELETE /v1/auth/me — per-membership check pred GDPR erasure
 *
 *   Transakčná bezpečnosť:
 *     Caller by mal volať assertNotLastAdmin() VNÚTRI aktívnej session
 *     (withTransaction callback) tak, aby DB read aj následný write boli
 *     atomické. Ak sa session neposkytne, funkcia beží bez transakcie
 *     (fallback pre jednoduché one-off kontroly).
 *
 *   Logika:
 *     1. Overí, či je target membership ADMIN (ak nie, check sa preskočí).
 *     2. Spočíta aktívnych ADMINov v org, vylúčiac targetUserId.
 *     3. Ak ostáva 0 ADMINov → vyhodí BadRequestError s kódom LAST_ADMIN.
 */

import { BadRequestError } from '../../plugins/error-handler.js';

import type { MembershipsRepository } from './memberships.repository.js';
import type { UserRole } from '@inventario/shared-types';
import type { ClientSession } from 'mongodb';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class MembershipsService {
  constructor(private readonly repo: MembershipsRepository) {}

  /**
   * Skontroluje, či odstránenie/degradácia membership nezanechá org bez ADMINa.
   *
   * @param organisationId  - tenant scope
   * @param targetUserId    - userId membership, ktorá sa má odobrať/zmeniť
   * @param targetRoles     - súčasné role target membership (pred zmenou)
   * @param session         - aktívna MongoDB ClientSession (pre transakčnú atomicitu)
   *
   * Vyhodí BadRequestError('LAST_ADMIN: ...') ak by operácia zanechala
   * organizáciu bez administrátora.
   */
  async assertNotLastAdmin(
    organisationId: string,
    targetUserId: string,
    targetRoles: readonly UserRole[],
    session?: ClientSession,
  ): Promise<void> {
    // Ak target membership nie je ADMIN, check nie je potrebný
    if (!targetRoles.includes('ADMIN' as UserRole)) {
      return;
    }

    const remainingAdmins = await this.repo.countActiveAdmins(
      organisationId,
      targetUserId,
      session,
    );

    if (remainingAdmins === 0) {
      throw new BadRequestError(
        'LAST_ADMIN: Organizácia musí mať aspoň jedného aktívneho administrátora. ' +
          'Najprv povýšte iného člena na ADMIN, potom vykonajte túto operáciu.',
      );
    }
  }

  /**
   * Skontroluje, či má targetUserId rolu ADMIN v danom tente
   * a ak áno, overí, že nie je posledným administrátorom.
   *
   * Convenience wrapper pre DELETE /v1/auth/me — kontroluje všetky tenante
   * kde user je ADMIN.
   *
   * @param organisationId  - tenant scope
   * @param targetUserId    - userId, ktorý opúšťa org / maže účet
   * @param session         - aktívna MongoDB ClientSession
   */
  async assertNotLastAdminForDeletion(
    organisationId: string,
    targetUserId: string,
    session?: ClientSession,
  ): Promise<void> {
    // Načítame aktívnu membership priamo z DB (nie z cache — chceme live stav)
    const membership = await this.repo.findActive(
      { userId: targetUserId, organisationId },
      session,
    );

    // Ak nemá aktívnu membership alebo nie je ADMIN → OK, môže odísť
    if (!membership || !membership.roles.includes('ADMIN' as UserRole)) {
      return;
    }

    const remainingAdmins = await this.repo.countActiveAdmins(
      organisationId,
      targetUserId,
      session,
    );

    if (remainingAdmins === 0) {
      throw new BadRequestError(
        `LAST_ADMIN: Ste posledný administrátor v organizácii (${organisationId}). ` +
          'Pred zmazaním účtu musíte povýšiť iného člena na ADMIN.',
      );
    }
  }
}

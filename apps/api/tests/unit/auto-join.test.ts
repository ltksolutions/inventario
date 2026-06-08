// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Unit testy pre selectAutoJoinOrg — čistá logika výberu org pre auto-join
 * podľa firemnej domény (DOMAIN_RESTRICTED). Bez DB, bez Fastify.
 */

import { describe, expect, it } from 'vitest';

import { selectAutoJoinOrg, type AutoJoinOrgCandidate } from '../../src/lib/auto-join.js';

const sfz = {
  id: 'sfz',
  status: 'ACTIVE',
  memberJoinPolicy: 'DOMAIN_RESTRICTED',
  autoJoinDomains: ['futbalsfz.sk'],
  entraTenantId: 'bcd6945a-5a57-4c2b-9ebb-d62712ad4b55',
} satisfies AutoJoinOrgCandidate & { id: string };

describe('selectAutoJoinOrg', () => {
  it('vráti ok pri práve jednej DOMAIN_RESTRICTED zhode (Microsoft, tid sedí)', () => {
    const res = selectAutoJoinOrg([sfz], 'futbalsfz.sk', 'microsoft', sfz.entraTenantId);
    expect(res.kind).toBe('ok');
    if (res.kind === 'ok') expect(res.org).toBe(sfz);
  });

  it('je case-insensitive na doménu', () => {
    const res = selectAutoJoinOrg([sfz], 'FutbalSFZ.SK', 'microsoft', sfz.entraTenantId);
    expect(res.kind).toBe('ok');
  });

  it('vráti none keď doména nesedí', () => {
    const res = selectAutoJoinOrg([sfz], 'gmail.com', 'microsoft', sfz.entraTenantId);
    expect(res.kind).toBe('none');
  });

  it('vráti none pre INVITE_ONLY org aj keď doména sedí', () => {
    const inviteOnly = { ...sfz, memberJoinPolicy: 'INVITE_ONLY' };
    const res = selectAutoJoinOrg([inviteOnly], 'futbalsfz.sk', 'microsoft', sfz.entraTenantId);
    expect(res.kind).toBe('none');
  });

  it('vráti none pre neaktívnu org', () => {
    const inactive = { ...sfz, status: 'SUSPENDED' };
    const res = selectAutoJoinOrg([inactive], 'futbalsfz.sk', 'microsoft', sfz.entraTenantId);
    expect(res.kind).toBe('none');
  });

  it('vráti ambiguous keď doménu nárokuje viac orgov', () => {
    const other = { ...sfz, id: 'other', entraTenantId: null };
    const res = selectAutoJoinOrg([sfz, other], 'futbalsfz.sk', 'microsoft', sfz.entraTenantId);
    expect(res.kind).toBe('ambiguous');
    if (res.kind === 'ambiguous') expect(res.count).toBe(2);
  });

  it('vráti tenant_mismatch keď Microsoft tid nesedí s org.entraTenantId', () => {
    const res = selectAutoJoinOrg([sfz], 'futbalsfz.sk', 'microsoft', 'iny-tenant-uuid');
    expect(res.kind).toBe('tenant_mismatch');
  });

  it('Google ignoruje entraTenantId (tenant check je len pre Microsoft)', () => {
    const res = selectAutoJoinOrg([sfz], 'futbalsfz.sk', 'google', null);
    expect(res.kind).toBe('ok');
  });

  it('Microsoft bez tid v tokene auto-join nezablokuje (zhoduje sa s existujúcou logikou)', () => {
    const res = selectAutoJoinOrg([sfz], 'futbalsfz.sk', 'microsoft', undefined);
    expect(res.kind).toBe('ok');
  });

  it('prázdna doména → none', () => {
    const res = selectAutoJoinOrg([sfz], '', 'microsoft', sfz.entraTenantId);
    expect(res.kind).toBe('none');
  });
});

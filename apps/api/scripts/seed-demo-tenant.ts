// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/* eslint-disable no-console -- CLI seed skript: konzolový výstup je zámerný. */

/**
 * Seed DEMO tenant — naplní samostatnú demo organizáciu reprezentatívnymi
 * (fiktívnymi) dátami pre marketingové screenshoty. ŽIADNE reálne PII.
 *
 * Prečo: produkčný SFZ tenant obsahuje reálne mená a len pár položiek —
 * nevhodné pre verejné screenshoty. Tento skript vytvorí izolovaný demo
 * tenant (slug `demo`) s peknými dátami pre všetkých 6 P0 obrazoviek.
 *
 * BEZPEČNOSŤ (píše do DB, ktorú zvolíš cez env):
 *   - DRY-RUN je default — bez `--confirm` len vypíše plán a NIČ nezapíše.
 *   - Všetky zápisy sú scoped VÝHRADNE na demo organizáciu (jej organisationId).
 *     Skript NIKDY nesiahne na iné tenanty (napr. SFZ).
 *   - Idempotentný: ak demo org so slug-om už existuje, skript skončí
 *     (alebo s `--reset` najprv zmaže LEN dáta demo orgu a vytvorí nanovo).
 *   - `--reset` NEMAŽE tvoj admin user — len jeho membership v demo orgu.
 *
 * Použitie (spúšťa Janika, lebo píše do prod):
 *   # náhľad plánu (nič nezapíše):
 *   MONGO_URI="..." MONGO_DB_NAME="<prod-db>" \
 *     pnpm --filter @inventario/api seed:demo
 *
 *   # reálny zápis:
 *   MONGO_URI="..." MONGO_DB_NAME="<prod-db>" \
 *     pnpm --filter @inventario/api seed:demo -- --confirm
 *
 *   # prepísať existujúci demo tenant nanovo:
 *   ... seed:demo -- --confirm --reset
 *
 *   # iný admin / slug:
 *   ... seed:demo -- --confirm --admin-email=jan.letko@futbalsfz.sk --slug=demo
 *
 * Po seede: v appke (app.inventario.estate) prepni organizáciu na „Demo"
 * a sprav screenshoty. Preberacie protokoly (obrazovka /protocols) vyrob
 * v appke cez „vytvoriť protokol" na demo výpožičke — protokol + PDF tak
 * vznikne reálnym kódom (skript ich zámerne negeneruje, lebo PDF snapshot
 * je bezpečnejšie nechať na service vrstvu).
 */

import { MongoClient, ObjectId } from 'mongodb';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const CONFIRM = args.includes('--confirm');
const RESET = args.includes('--reset');
const SLUG = (args.find((a) => a.startsWith('--slug='))?.split('=')[1] ?? 'demo').toLowerCase();
const ADMIN_EMAIL =
  args.find((a) => a.startsWith('--admin-email='))?.split('=')[1] ?? 'jan.letko@futbalsfz.sk';

const MONGO_URI = process.env['MONGO_URI'];
const DB_NAME = process.env['MONGO_DB_NAME'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const now = () => new Date().toISOString();
const SYS = 'demo-seed';
function token(): string {
  // 32 hex znakov — neuhádnuteľný publicToken pre QR (ADR-0021).
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}
function daysFromNow(d: number): string {
  return new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Demo dáta (fiktívne, žiadne reálne PII)
// ---------------------------------------------------------------------------

const ORG_DISPLAY = 'ŠK Demo Inventário';
const INV_PREFIX = 'DEMO';

// Fiktívni členovia (display-only, neprihlasujú sa).
const MEMBERS = [
  { firstName: 'Eva', lastName: 'Horáková', role: 'ASSET_MANAGER' },
  { firstName: 'Marek', lastName: 'Kováč', role: 'EMPLOYEE' },
  { firstName: 'Lucia', lastName: 'Bieliková', role: 'EMPLOYEE' },
  { firstName: 'Peter', lastName: 'Novák', role: 'EMPLOYEE' },
  { firstName: 'Zuzana', lastName: 'Malá', role: 'EMPLOYEE' },
  { firstName: 'Tomáš', lastName: 'Urban', role: 'EMPLOYEE' },
];

// Hierarchia kategórií: root „skupiny" + podkategórie (majetok ide do podkategórií, ADR-0028b).
const CATEGORY_TREE: { group: string; subs: string[] }[] = [
  { group: 'IT vybavenie', subs: ['Notebooky', 'Tablety', 'Monitory'] },
  { group: 'Športové vybavenie', subs: ['Lopty', 'Tréningové pomôcky', 'Dresy'] },
  { group: 'Foto/Video', subs: ['Kamery', 'Statívy'] },
  { group: 'Mobiliár a ostatné', subs: ['Nábytok', 'Elektro'] },
];

const LOCATIONS = [
  { name: 'Centrála — sídlo klubu', type: 'OFFICE' },
  { name: 'Hlavný sklad', type: 'WAREHOUSE' },
  { name: 'Štadión — depozit', type: 'STADIUM' },
  { name: 'Tréningové centrum', type: 'TRAINING_CENTER' },
];

const CONDITIONS = [
  { name: 'Nový', slug: 'novy' },
  { name: 'Dobrý', slug: 'dobry' },
  { name: 'Opotrebovaný', slug: 'opotrebovany' },
];

// SERIALIZED položky (každá 1 ks, sériové číslo). subIdx = index podkategórie v zozname SUBS.
const SERIALIZED: { name: string; sub: string; manufacturer?: string; model?: string }[] = [
  { name: 'Lenovo ThinkPad X1 Carbon', sub: 'Notebooky', manufacturer: 'Lenovo', model: 'X1 G11' },
  { name: 'MacBook Air M3', sub: 'Notebooky', manufacturer: 'Apple', model: 'Mac15,12' },
  { name: 'Dell Latitude 5450', sub: 'Notebooky', manufacturer: 'Dell', model: '5450' },
  { name: 'iPad 10. gen', sub: 'Tablety', manufacturer: 'Apple', model: 'iPad10' },
  { name: 'Samsung Galaxy Tab S9', sub: 'Tablety', manufacturer: 'Samsung', model: 'SM-X710' },
  { name: 'Dell UltraSharp U2724DE', sub: 'Monitory', manufacturer: 'Dell', model: 'U2724DE' },
  { name: 'LG 27UP850 4K', sub: 'Monitory', manufacturer: 'LG', model: '27UP850' },
  { name: 'Sony Alpha A7 IV', sub: 'Kamery', manufacturer: 'Sony', model: 'ILCE-7M4' },
  { name: 'GoPro HERO12 Black', sub: 'Kamery', manufacturer: 'GoPro', model: 'HERO12' },
  { name: 'Manfrotto statív MT055', sub: 'Statívy', manufacturer: 'Manfrotto', model: 'MT055' },
  { name: 'Kancelárska stolička ErgoPro', sub: 'Nábytok', manufacturer: 'ErgoPro' },
  { name: 'Projektor Epson EB-2250U', sub: 'Elektro', manufacturer: 'Epson', model: 'EB-2250U' },
];

// BULK položky (množstevné, sklad). qty = počiatočný stav.
const BULK: { name: string; sub: string; qty: number }[] = [
  { name: 'Futbalová lopta Adidas Tiro', sub: 'Lopty', qty: 40 },
  { name: 'Tréningový kužeľ (sada)', sub: 'Tréningové pomôcky', qty: 120 },
  { name: 'Rozlišovacie dresy (set)', sub: 'Dresy', qty: 60 },
  { name: 'Predlžovací kábel 5m', sub: 'Elektro', qty: 25 },
  { name: 'HDMI kábel 2m', sub: 'Elektro', qty: 35 },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!MONGO_URI || !DB_NAME) {
    console.error('❌ Chýba MONGO_URI alebo MONGO_DB_NAME v env. Príklad:');
    console.error(
      '   MONGO_URI="mongodb+srv://..." MONGO_DB_NAME="<db>" pnpm --filter @inventario/api seed:demo',
    );
    process.exit(1);
  }

  console.log(`\n🌱 Seed DEMO tenant`);
  console.log(`   DB:          ${DB_NAME}`);
  console.log(`   Slug:        ${SLUG}`);
  console.log(`   Admin:       ${ADMIN_EMAIL}`);
  console.log(
    `   Režim:       ${CONFIRM ? '✍️  ZÁPIS' : '👀 DRY-RUN (nič sa nezapíše)'}${RESET ? ' + RESET' : ''}\n`,
  );

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  try {
    const orgs = db.collection('organisations');
    const existing = await orgs.findOne({ slug: SLUG });

    if (existing && !RESET) {
      console.log(`⚠️  Demo org so slug "${SLUG}" už existuje (id ${String(existing._id)}).`);
      console.log('   Spusti s --reset na prepísanie, alebo zvoľ iný --slug. Končím bez zmien.');
      return;
    }

    // --- RESET: zmaž LEN dáta demo orgu -------------------------------------
    if (existing && RESET) {
      const demoId = String(existing._id);
      console.log(`♻️  RESET demo orgu ${demoId} — mažem jeho dáta (nie iné tenanty).`);
      if (CONFIRM) {
        for (const coll of [
          'assets',
          'categories',
          'locations',
          'asset_conditions',
          'loans',
          'loan_requests',
          'loan_protocols',
          'stock_movements',
          'attachments',
          'audit_logs',
          'notifications',
        ]) {
          const r = await db.collection(coll).deleteMany({ organisationId: demoId });
          if (r.deletedCount) console.log(`   - ${coll}: -${r.deletedCount}`);
        }
        // demo členovia (users vytvorení týmto seedom) + ich memberships
        await db.collection('memberships').deleteMany({ organisationId: demoId });
        await db.collection('users').deleteMany({ organisationId: demoId, createdBy: SYS });
        await orgs.deleteOne({ _id: existing._id });
        console.log('   - organisation + memberships + demo users zmazané.');
      }
    }

    // --- Plán / zápis -------------------------------------------------------
    const orgId = new ObjectId();
    const ts = now();

    const orgDoc = {
      _id: orgId,
      displayName: ORG_DISPLAY,
      slug: SLUG,
      entraTenantId: null,
      customDomain: null,
      status: 'ACTIVE',
      plan: 'PRO_STANDARD',
      primaryContactEmail: 'demo@inventario.estate',
      brandKit: null,
      settings: {},
      appBaseUrl: 'https://app.inventario.estate',
      publicAssetLookup: false,
      foundContactInfo: null,
      inventoryNumberFormat: {
        prefix: INV_PREFIX,
        padding: 4,
        includeYear: true,
        resetYearly: true,
      },
      protocolSettings: null,
      labelPrinting: null,
      oauthCredentials: null,
      createdAt: ts,
      updatedAt: ts,
      createdBy: SYS,
      updatedBy: SYS,
      deletedAt: null,
      deletedBy: null,
    };

    // Admin (existujúci používateľ) — pridáme len membership.
    const admin = await db.collection('users').findOne({ email: ADMIN_EMAIL, deletedAt: null });
    if (!admin) {
      console.log(`⚠️  Admin user ${ADMIN_EMAIL} sa nenašiel — membership nebude pridaný.`);
      console.log(
        '   (Prihlás sa aspoň raz do appky, aby existoval, alebo zadaj iný --admin-email.)',
      );
    }

    // Vytvor demo členov (display-only).
    const memberDocs = MEMBERS.map((m) => ({
      _id: new ObjectId(),
      organisationId: String(orgId),
      email: `${m.firstName}.${m.lastName}@demo.inventario.test`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, ''),
      firstName: m.firstName,
      lastName: m.lastName,
      displayName: `${m.firstName} ${m.lastName}`,
      accountType: 'ENTRA_ID',
      entraOid: `00000000-0000-4000-8000-${token().slice(0, 12)}`,
      authProviders: [],
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpiresAt: null,
      passwordResetToken: null,
      passwordResetExpiresAt: null,
      passwordHash: null,
      roles: [m.role],
      organizationalUnit: null,
      teams: [],
      isActive: true,
      lastLoginAt: null,
      invitationSentAt: null,
      mustChangePassword: false,
      preferences: {
        language: 'sk',
        timezone: 'Europe/Bratislava',
        emailNotifications: true,
        pushNotifications: false,
      },
      createdAt: ts,
      updatedAt: ts,
      createdBy: SYS,
      updatedBy: SYS,
      deletedAt: null,
      deletedBy: null,
      _role: m.role, // pomocné, odstránime pred insertom
    }));

    // Kategórie: root + sub
    const rootDocs: Record<string, ObjectId> = {};
    const subDocs: Record<string, ObjectId> = {};
    const categoryInserts: Record<string, unknown>[] = [];
    let sort = 0;
    for (const node of CATEGORY_TREE) {
      const rid = new ObjectId();
      rootDocs[node.group] = rid;
      categoryInserts.push({
        _id: rid,
        organisationId: String(orgId),
        name: node.group,
        slug: node.group
          .toLowerCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
        parentId: null,
        description: null,
        icon: null,
        color: null,
        approverIds: [],
        requiresApprovalByDefault: true,
        maxLoanDays: null,
        isActive: true,
        sortOrder: sort++,
        createdAt: ts,
        updatedAt: ts,
        createdBy: SYS,
        updatedBy: SYS,
        deletedAt: null,
        deletedBy: null,
      });
      for (const sub of node.subs) {
        const sid = new ObjectId();
        subDocs[sub] = sid;
        categoryInserts.push({
          _id: sid,
          organisationId: String(orgId),
          name: sub,
          slug: sub
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, ''),
          parentId: String(rid),
          description: null,
          icon: null,
          color: null,
          approverIds: [],
          requiresApprovalByDefault: true,
          maxLoanDays: null,
          isActive: true,
          sortOrder: sort++,
          createdAt: ts,
          updatedAt: ts,
          createdBy: SYS,
          updatedBy: SYS,
          deletedAt: null,
          deletedBy: null,
        });
      }
    }

    // Lokality
    const locInserts = LOCATIONS.map((l, i) => ({
      _id: new ObjectId(),
      organisationId: String(orgId),
      name: l.name,
      slug: l.name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
      type: l.type,
      address: null,
      coordinates: null,
      parentId: null,
      description: null,
      managerId: null,
      isActive: true,
      sortOrder: i,
      createdAt: ts,
      updatedAt: ts,
      createdBy: SYS,
      updatedBy: SYS,
      deletedAt: null,
      deletedBy: null,
    }));

    // Asset conditions (číselník)
    const condInserts = CONDITIONS.map((c, i) => ({
      _id: new ObjectId(),
      organisationId: String(orgId),
      name: c.name,
      slug: c.slug,
      icon: null,
      color: null,
      isActive: true,
      sortOrder: i,
      createdAt: ts,
      updatedAt: ts,
      createdBy: SYS,
      updatedBy: SYS,
      deletedAt: null,
      deletedBy: null,
    }));

    // Assets + stock movements
    let invSeq = 0;
    const invNum = () => `${INV_PREFIX}-2026-${String(++invSeq).padStart(4, '0')}`;
    const primaryLoc = locInserts[1]!._id; // Hlavný sklad
    const assetInserts: Record<string, unknown>[] = [];
    const stockInserts: Record<string, unknown>[] = [];

    const baseAsset = (overrides: Record<string, unknown>) => ({
      _id: new ObjectId(),
      organisationId: String(orgId),
      inventoryNumber: invNum(),
      publicToken: token(),
      serialNumber: null,
      description: null,
      manufacturer: null,
      model: null,
      acquiredAt: daysFromNow(-200),
      acquisitionCost: null,
      warrantyUntil: null,
      specs: {},
      tags: [],
      imageIds: [],
      internalNotes: null,
      isLoanable: true,
      requiresApproval: true,
      currentLoanId: null,
      quantityOnHand: null,
      createdAt: ts,
      updatedAt: ts,
      createdBy: SYS,
      updatedBy: SYS,
      deletedAt: null,
      deletedBy: null,
      ...overrides,
    });

    for (const s of SERIALIZED) {
      assetInserts.push(
        baseAsset({
          name: s.name,
          categoryId: String(subDocs[s.sub]),
          locationId: String(locInserts[0]!._id),
          condition: 'GOOD',
          manufacturer: s.manufacturer ?? null,
          model: s.model ?? null,
          serialNumber: `SN-${token().slice(0, 8).toUpperCase()}`,
          status: 'AVAILABLE',
          trackingMode: 'SERIALIZED',
        }),
      );
    }

    for (const b of BULK) {
      const a = baseAsset({
        name: b.name,
        categoryId: String(subDocs[b.sub]),
        locationId: String(primaryLoc),
        condition: 'GOOD',
        status: 'AVAILABLE',
        trackingMode: 'BULK',
        quantityOnHand: b.qty,
      });
      assetInserts.push(a);
      stockInserts.push({
        _id: new ObjectId(),
        organisationId: String(orgId),
        itemId: String(a._id),
        type: 'RECEIPT',
        quantity: b.qty,
        balanceAfter: b.qty,
        reason: 'Počiatočný príjem na sklad (demo seed)',
        loanId: null,
        locationId: String(primaryLoc),
        note: null,
        createdAt: ts,
        updatedAt: ts,
        createdBy: SYS,
        updatedBy: SYS,
      });
    }

    // Výpožičky: 1 ACTIVE (serialized → LOANED), 1 RETURNED, 1 PENDING request
    const borrower = memberDocs[1]!; // Marek Kováč (EMPLOYEE)
    const activeAsset = assetInserts[0]!; // ThinkPad
    activeAsset['status'] = 'LOANED';
    const activeLoanId = new ObjectId();
    activeAsset['currentLoanId'] = String(activeLoanId);

    const loanInserts = [
      {
        _id: activeLoanId,
        organisationId: String(orgId),
        requestId: '000000000000000000000000',
        borrowerId: String(borrower._id),
        purpose: 'Pracovný notebook na služobnú cestu',
        pickedUpAt: daysFromNow(-5),
        handedOverBy: String(memberDocs[0]!._id),
        dueAt: daysFromNow(9),
        returnedAt: null,
        returnedTo: null,
        items: [
          {
            assetId: String(activeAsset._id),
            snapshot: {
              inventoryNumber: activeAsset['inventoryNumber'],
              name: activeAsset['name'],
            },
            condition: {
              atPickup: { condition: 'GOOD', note: null, photoIds: [] },
              atReturn: null,
            },
          },
        ],
        status: 'ACTIVE',
        extensionCount: 0,
        handoverProtocolId: null,
        returnProtocolId: null,
        notes: null,
        createdAt: daysFromNow(-5),
        updatedAt: daysFromNow(-5),
        createdBy: String(borrower._id),
        updatedBy: String(borrower._id),
        deletedAt: null,
        deletedBy: null,
      },
      {
        _id: new ObjectId(),
        organisationId: String(orgId),
        requestId: '000000000000000000000000',
        borrowerId: String(memberDocs[2]!._id),
        purpose: 'Kamera na klubové podujatie',
        pickedUpAt: daysFromNow(-30),
        handedOverBy: String(memberDocs[0]!._id),
        dueAt: daysFromNow(-16),
        returnedAt: daysFromNow(-18),
        returnedTo: String(memberDocs[0]!._id),
        items: [
          {
            assetId: String(assetInserts[7]!._id),
            snapshot: {
              inventoryNumber: assetInserts[7]!['inventoryNumber'],
              name: assetInserts[7]!['name'],
            },
            condition: {
              atPickup: { condition: 'GOOD', note: null, photoIds: [] },
              atReturn: { condition: 'GOOD', note: null, photoIds: [] },
            },
          },
        ],
        status: 'RETURNED',
        extensionCount: 0,
        handoverProtocolId: null,
        returnProtocolId: null,
        notes: null,
        createdAt: daysFromNow(-30),
        updatedAt: daysFromNow(-18),
        createdBy: String(memberDocs[2]!._id),
        updatedBy: String(memberDocs[0]!._id),
        deletedAt: null,
        deletedBy: null,
      },
    ];

    const reqInserts = [
      {
        _id: new ObjectId(),
        organisationId: String(orgId),
        requesterId: String(memberDocs[3]!._id),
        beneficiaryId: String(memberDocs[3]!._id),
        purpose: 'Potrebujem tablet na tréningovú analýzu',
        plannedFrom: daysFromNow(1),
        plannedTo: daysFromNow(14),
        items: [
          {
            categoryId: String(subDocs['Tablety']),
            categorySnapshot: { name: 'Tablety', slug: 'tablety' },
            quantityRequested: 1,
            quantityFulfilled: 0,
            note: null,
          },
        ],
        status: 'PENDING',
        approvers: [],
        resultingLoanIds: [],
        rejectionReason: null,
        teamId: null,
        idempotencyKey: null,
        createdAt: daysFromNow(-1),
        updatedAt: daysFromNow(-1),
        createdBy: String(memberDocs[3]!._id),
        updatedBy: String(memberDocs[3]!._id),
        deletedAt: null,
        deletedBy: null,
      },
    ];

    // --- Plán summary -------------------------------------------------------
    console.log('📦 Plán:');
    console.log(`   organisation:     1 (${ORG_DISPLAY}, slug=${SLUG}, plan=PRO_STANDARD)`);
    console.log(`   admin membership: ${admin ? 1 : 0} (${ADMIN_EMAIL} → ADMIN)`);
    console.log(`   demo členovia:    ${memberDocs.length} (users + memberships)`);
    console.log(
      `   kategórie:        ${categoryInserts.length} (${CATEGORY_TREE.length} skupín + podkategórie)`,
    );
    console.log(`   lokality:         ${locInserts.length}`);
    console.log(`   stavy majetku:    ${condInserts.length}`);
    console.log(
      `   majetok:          ${assetInserts.length} (${SERIALIZED.length} SERIALIZED + ${BULK.length} BULK)`,
    );
    console.log(`   stock movements:  ${stockInserts.length} (RECEIPT pre BULK)`);
    console.log(`   výpožičky:        ${loanInserts.length} (1 ACTIVE, 1 RETURNED)`);
    console.log(`   žiadosti:         ${reqInserts.length} (1 PENDING — „Čaká na vás")`);

    if (!CONFIRM) {
      console.log('\n👀 DRY-RUN — nič sa nezapísalo. Spusti znova s `-- --confirm`.\n');
      return;
    }

    // --- Zápis --------------------------------------------------------------
    await orgs.insertOne(orgDoc);

    const membershipDocs: Record<string, unknown>[] = [];
    if (admin) {
      const dup = await db
        .collection('memberships')
        .findOne({ userId: String(admin._id), organisationId: String(orgId), deletedAt: null });
      if (!dup) {
        membershipDocs.push(membership(String(admin._id), String(orgId), 'ADMIN', ts));
      }
    }
    for (const m of memberDocs) {
      const role = m._role as string;
      delete (m as Record<string, unknown>)['_role'];
      membershipDocs.push(membership(String(m._id), String(orgId), role, ts));
    }

    await db.collection('users').insertMany(memberDocs);
    await db.collection('memberships').insertMany(membershipDocs);
    await db.collection('categories').insertMany(categoryInserts);
    await db.collection('locations').insertMany(locInserts);
    await db.collection('asset_conditions').insertMany(condInserts);
    await db.collection('assets').insertMany(assetInserts);
    if (stockInserts.length) await db.collection('stock_movements').insertMany(stockInserts);
    await db.collection('loans').insertMany(loanInserts);
    await db.collection('loan_requests').insertMany(reqInserts);

    console.log(`\n✅ Hotovo. Demo org id: ${String(orgId)}`);
    console.log('   V appke prepni organizáciu na „ŠK Demo Inventário" a sprav screenshoty.');
    console.log(
      '   Protokoly: vytvor v appke na ACTIVE/RETURNED výpožičke (POST /v1/loans/:id/protocols).\n',
    );
  } finally {
    await client.close();
  }
}

function membership(
  userId: string,
  organisationId: string,
  role: string,
  ts: string,
): Record<string, unknown> {
  return {
    _id: new ObjectId(),
    userId,
    organisationId,
    role,
    status: 'ACTIVE',
    isDefault: false,
    mustChangePassword: false,
    notifications: { email: true, push: false },
    organizationalUnit: null,
    teams: [],
    lastAccessedAt: null,
    acceptedAt: ts,
    invitedBy: SYS,
    invitedAt: ts,
    createdAt: ts,
    updatedAt: ts,
    createdBy: SYS,
    updatedBy: SYS,
    deletedAt: null,
    deletedBy: null,
  };
}

main().catch((err) => {
  console.error('❌ Seed zlyhal:', err);
  process.exit(1);
});

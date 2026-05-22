// Faz 1 data migration: Railway Postgres -> Neon.
// - Copies ALL tables in FK-dependency (topological) order.
// - EXCLUDES vector columns (embedding) — those get re-embedded to BGE-M3
//   1024-dim in Faz 3, so transferring the 768-dim vectors (~1.8GB) is waste.
// - Resumable + idempotent: INSERT ... ON CONFLICT (pk) DO NOTHING, keyset
//   pagination by a stable order so a re-run continues cleanly.
//
// Env: SRC_URL (Railway), DST_URL (Neon). Optional ONLY="Table1,Table2".
import postgres from "postgres";

const SRC = postgres(process.env.SRC_URL, { ssl: "require", max: 4 });
const DST = postgres(process.env.DST_URL, { ssl: "require", max: 4 });
const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
const BATCH = 1000;

async function meta(sql) {
  const cols = await sql`
    SELECT table_name t, column_name c, udt_name u, is_generated g, ordinal_position p
    FROM information_schema.columns
    WHERE table_schema='public' ORDER BY table_name, ordinal_position`;
  const pks = await sql`
    SELECT tc.table_name t, kcu.column_name c, kcu.ordinal_position p
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name
    WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema='public'
    ORDER BY tc.table_name, kcu.ordinal_position`;
  const fks = await sql`
    SELECT tc.table_name child, ccu.table_name parent
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name
    WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'`;
  const tables = {};
  for (const r of cols) {
    (tables[r.t] ||= { cols: [], vec: [], pk: [] });
    if (r.u === "vector") tables[r.t].vec.push(r.c);
    else if (r.g === "ALWAYS") { /* generated (e.g. tsvector) — derived, skip */ }
    else tables[r.t].cols.push(r.c);
  }
  for (const r of pks) tables[r.t]?.pk.push(r.c);
  return { tables, fks };
}

function toposort(tableNames, fks) {
  const deps = new Map(tableNames.map((t) => [t, new Set()]));
  for (const f of fks) {
    if (f.child === f.parent) continue; // self-ref: handle within table
    if (deps.has(f.child) && tableNames.includes(f.parent)) deps.get(f.child).add(f.parent);
  }
  const out = [], done = new Set();
  let guard = 0;
  while (out.length < tableNames.length) {
    let progressed = false;
    for (const t of tableNames) {
      if (done.has(t)) continue;
      if ([...deps.get(t)].every((p) => done.has(p))) { out.push(t); done.add(t); progressed = true; }
    }
    if (!progressed) { // cycle fallback: emit remaining as-is
      for (const t of tableNames) if (!done.has(t)) { out.push(t); done.add(t); }
    }
    if (++guard > tableNames.length + 5) break;
  }
  return out;
}

async function copyTable(name, info) {
  const selectCols = info.cols; // non-vector columns only
  const order = info.pk.length ? info.pk : [selectCols[0]];
  const srcCount = (await SRC`SELECT COUNT(*)::int n FROM ${SRC(name)}`)[0].n;
  const dstStart = (await DST`SELECT COUNT(*)::int n FROM ${DST(name)}`)[0].n;
  if (srcCount === 0) { console.log(`  ${name}: 0 satır, atla`); return; }
  if (dstStart >= srcCount) { console.log(`  ${name}: zaten ${dstStart}/${srcCount}, atla`); return; }

  const colList = SRC(selectCols);
  const orderList = SRC(order);
  let copied = 0, cursor = null;
  while (true) {
    let rows;
    if (cursor === null) {
      rows = await SRC`SELECT ${colList} FROM ${SRC(name)} ORDER BY ${orderList} LIMIT ${BATCH}`;
    } else {
      // keyset on single-column order (pk[0]); composite handled by offset fallback
      if (order.length === 1) {
        rows = await SRC`SELECT ${colList} FROM ${SRC(name)} WHERE ${SRC(order[0])} > ${cursor} ORDER BY ${orderList} LIMIT ${BATCH}`;
      } else {
        rows = await SRC`SELECT ${colList} FROM ${SRC(name)} ORDER BY ${orderList} OFFSET ${copied} LIMIT ${BATCH}`;
      }
    }
    if (rows.length === 0) break;
    const insertCols = info.vec.length ? selectCols : undefined; // explicit cols when vec excluded
    if (info.pk.length) {
      await DST`INSERT INTO ${DST(name)} ${DST(rows, ...selectCols)} ON CONFLICT (${DST(info.pk)}) DO NOTHING`;
    } else {
      await DST`INSERT INTO ${DST(name)} ${DST(rows, ...selectCols)} ON CONFLICT DO NOTHING`;
    }
    copied += rows.length;
    if (order.length === 1) cursor = rows[rows.length - 1][order[0]];
    if (copied % 10000 === 0 || rows.length < BATCH)
      console.log(`  ${name}: ${dstStart + copied}/${srcCount}`);
    if (rows.length < BATCH) break;
  }
  const dstEnd = (await DST`SELECT COUNT(*)::int n FROM ${DST(name)}`)[0].n;
  console.log(`  ✓ ${name}: ${dstEnd}/${srcCount}${info.vec.length ? ` (vektör atlandı: ${info.vec.join(",")})` : ""}`);
}

(async () => {
  const { tables, fks } = await meta(SRC);
  let names = Object.keys(tables);
  if (ONLY.length) names = names.filter((n) => ONLY.includes(n));
  const ordered = toposort(names, fks);
  console.log("Sıra:", ordered.join(" → "));
  for (const t of ordered) {
    try { await copyTable(t, tables[t]); }
    catch (e) { console.log(`  ✗ ${t} HATA: ${String(e.message || e).slice(0, 160)}`); }
  }
  await SRC.end(); await DST.end();
  console.log("BİTTİ.");
})();

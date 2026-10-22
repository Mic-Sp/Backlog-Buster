import { Suspense } from "react";
import { connection } from "next/server";
import { prisma } from "@/lib/prisma";
import LayoutText from "@/components/LayoutText";

async function RegisteredMembers() {
  await connection();
  let count: number;
  try {
    // Count accounts only; the unclaimed local archive is not a registered member.
    count = await prisma.player.count({ where: { email: { not: null }, passwordHash: { not: null } } });
  } catch {
    return <p className="member-count"><LayoutText cyberpunk="MEMBER COUNT TEMPORARILY OFFLINE" fantasy="ADVENTURER ROLL TEMPORARILY UNAVAILABLE" /></p>;
  }
  return <p className="member-count"><span className="cyberpunk-label" aria-hidden="true">◉</span><svg className="fantasy-label member-count-crest" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="m12 2 5 9H7Zm-5 9 5 9H2Zm10 0 5 9H12Z" /></svg> <strong>{count.toLocaleString("en-US")}</strong> <LayoutText cyberpunk={`REGISTERED ${count === 1 ? "MEMBER" : "MEMBERS"}`} fantasy={`REGISTERED ${count === 1 ? "ADVENTURER" : "ADVENTURERS"}`} /></p>;
}

export default function MemberCount() {
  return <Suspense fallback={<p className="member-count"><LayoutText cyberpunk="SCANNING MEMBER REGISTRY…" fantasy="UNFURLING THE ADVENTURER ROLL…" /></p>}><RegisteredMembers /></Suspense>;
}

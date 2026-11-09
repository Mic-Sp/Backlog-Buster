
import { registeredPlayerWhere } from "@/lib/auth-policy";
import { Suspense } from "react";
import { connection } from "next/server";
import { prisma } from "@/lib/prisma";

// This boundary can stream after the device theme has already hydrated. Static
// theme variants keep its server/client markup identical at any arrival time.
function RegistryText({ cyberpunk, fantasy }: { cyberpunk: string; fantasy: string }) {
  return <><span className="cyberpunk-label">{cyberpunk}</span><span className="fantasy-label">{fantasy}</span></>;
}

async function RegisteredMembers() {
  await connection();
  let count: number;
  try {
    // Count accounts only; the unclaimed local archive is not a registered member.
    count = await prisma.player.count({ where: { ...registeredPlayerWhere } });
  } catch {
    return <p className="member-count"><RegistryText cyberpunk="MEMBER COUNT TEMPORARILY OFFLINE" fantasy="ADVENTURER ROLL TEMPORARILY UNAVAILABLE" /></p>;
  }
  return <p className="member-count"><span className="cyberpunk-label" aria-hidden="true">◉</span><svg className="fantasy-label member-count-crest" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="m12 2 5 9H7Zm-5 9 5 9H2Zm10 0 5 9H12Z" /></svg> <strong>{count.toLocaleString("en-US")}</strong> <RegistryText cyberpunk={`REGISTERED ${count === 1 ? "MEMBER" : "MEMBERS"}`} fantasy={`REGISTERED ${count === 1 ? "ADVENTURER" : "ADVENTURERS"}`} /></p>;
}

export default function MemberCount() {
  return <Suspense fallback={<p className="member-count"><RegistryText cyberpunk="SCANNING MEMBER REGISTRY…" fantasy="UNFURLING THE ADVENTURER ROLL…" /></p>}><RegisteredMembers /></Suspense>;
}

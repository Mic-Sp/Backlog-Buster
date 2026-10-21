import { Suspense } from "react";
import { connection } from "next/server";
import { prisma } from "@/lib/prisma";

async function RegisteredMembers() {
  await connection();
  let count: number;
  try {
    // Count accounts only; the unclaimed local archive is not a registered member.
    count = await prisma.player.count({ where: { email: { not: null }, passwordHash: { not: null } } });
  } catch {
    return <p className="member-count">MEMBER COUNT TEMPORARILY OFFLINE</p>;
  }
  return <p className="member-count"><span aria-hidden="true">◉</span> <strong>{count.toLocaleString("en-US")}</strong> REGISTERED {count === 1 ? "MEMBER" : "MEMBERS"}</p>;
}

export default function MemberCount() {
  return <Suspense fallback={<p className="member-count">SCANNING MEMBER REGISTRY…</p>}><RegisteredMembers /></Suspense>;
}

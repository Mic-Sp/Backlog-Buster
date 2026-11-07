"use client";

import { OWNERSHIP_TYPES, type OwnershipFilter, type OwnershipType } from "@/lib/ownership-type";
import "./Ownership.css";

export function OwnershipField({ title, value, className }: { title?: string; value?: string | null; className?: string }) {
  return <label className={`${className ?? ""} ownership-field`}><span>Ownership / Access</span>
    <select name="ownershipType" aria-label={title ? `Ownership for ${title}` : "Ownership / Access"} defaultValue={value ?? ""}>
      <option value="">Unspecified</option>
      {OWNERSHIP_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
    </select>
    <small>Unspecified Steam titles default to Digital.</small>
  </label>;
}

export function OwnershipBadge({ value }: { value?: OwnershipType | null }) {
  return value ? <span className="ownership-badge" data-ownership-type={value} aria-label={`Access medium: ${value}`}>{value}</span> : null;
}

export function OwnershipFilterControl({ value, onChange }: { value: OwnershipFilter; onChange: (value: OwnershipFilter) => void }) {
  return <label><span>Ownership</span>
    <select aria-label="Filter by ownership" value={value} onChange={event => onChange(event.target.value as OwnershipFilter)}>
      <option value="">All ownership types</option>
      {OWNERSHIP_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
      <option value="Unspecified">Unspecified</option>
    </select>
  </label>;
}

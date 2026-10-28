// The four application policy classes (Phase 9) and how they map onto CIS Controls v8.1, Control 2.
import { POLICY_CLASSES, type PolicyClass } from "@policy";

export type ClassInfo = { label: string; machineId: string; meaning: string; cis: string; dot: string; bar: string };

// dot/bar are Tailwind classes on the --class-* tokens (src/styles/tokens.css).
export const CLASS_INFO: Record<PolicyClass, ClassInfo> = {
  core_system: {
    label: "Core system",
    machineId: "core-system",
    meaning: "Operating system, drivers, runtimes and security agents the asset needs to run.",
    cis: "Authorized · 2.1, 2.5",
    dot: "bg-class-core",
    bar: "bg-class-core",
  },
  sanctioned_app: {
    label: "Sanctioned",
    machineId: "sanctioned-app",
    meaning: "Approved for business use, with a business purpose and a supported version.",
    cis: "Authorized · 2.1, 2.2, 2.5",
    dot: "bg-class-sanctioned",
    bar: "bg-class-sanctioned",
  },
  tolerated_app: {
    label: "Tolerated",
    machineId: "tolerated-app",
    meaning: "Not authorized, kept under a documented exception with an owner, mitigating controls and a monthly review.",
    cis: "Documented exception · 2.2, 2.3",
    dot: "bg-class-tolerated",
    bar: "bg-class-tolerated",
  },
  unsanctioned_app: {
    label: "Unsanctioned",
    machineId: "unsanctioned-app",
    meaning: "Unauthorized or unsupported with no exception. Remove it from enterprise assets.",
    cis: "Unauthorized · 2.3",
    dot: "bg-class-unsanctioned",
    bar: "bg-class-unsanctioned",
  },
};

export const CLASS_ORDER: PolicyClass[] = POLICY_CLASSES;

// URLs use the machine id (/software?policy=unsanctioned-app); the enum value is accepted too.
export function classFromParam(value: string | null | undefined): PolicyClass | null {
  if (!value) return null;
  const v = value.trim().toLowerCase().replace(/-/g, "_");
  return (CLASS_ORDER as string[]).includes(v) ? (v as PolicyClass) : null;
}

export function classParam(cls: PolicyClass): string {
  return CLASS_INFO[cls].machineId;
}

export const KIND_SHORT: Record<string, string> = {
  program: "Programs",
  extension: "Browser extensions",
  ide_extension: "IDE extensions",
  package: "Packages",
};

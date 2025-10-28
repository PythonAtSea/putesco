"use client";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useMemo, useState } from "react";

type PackageInfo = {
  id: string;
  name: string;
  version?: string;
  resolved?: string;
  integrity?: string;
  dev?: boolean;
  optional?: boolean;
  peer?: boolean;
  extraneous?: boolean;
  path?: string;
  dependencies?: string[];
  requires?: string[];
  peerDependencies?: string[];
  bundledDependencies?: string[];
  sources: string[];
  raw?: Record<string, unknown>;
};

function extractPackages(lockFile: unknown): PackageInfo[] {
  if (typeof lockFile !== "object" || lockFile === null) {
    return [];
  }

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

  const asString = (value: unknown): string | undefined =>
    typeof value === "string" ? value : undefined;

  const asBoolean = (value: unknown): boolean | undefined =>
    typeof value === "boolean" ? value : undefined;

  const keysOf = (value: unknown): string[] | undefined => {
    if (!isRecord(value)) {
      return undefined;
    }
    const entries = Object.keys(value);
    return entries.length
      ? entries.sort((a, b) => a.localeCompare(b))
      : undefined;
  };

  const arrayOfStrings = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value)) {
      return undefined;
    }
    const filtered = value.filter(
      (item): item is string => typeof item === "string"
    );
    return filtered.length ? filtered : undefined;
  };

  const deriveNameFromPath = (
    packagePath: string | undefined
  ): string | undefined => {
    if (!packagePath) {
      return undefined;
    }

    const segments = packagePath.split("node_modules/").filter(Boolean);
    if (!segments.length) {
      return undefined;
    }

    return segments.pop()?.replace(/\/$/, "");
  };

  let idCounter = 0;
  const createId = (prefix: string, parts: (string | undefined)[]) => {
    const slug = parts
      .filter((part) => typeof part === "string" && part.trim().length > 0)
      .join("|");
    if (slug) {
      return `${prefix}:${slug}`;
    }
    idCounter += 1;
    return `${prefix}:entry-${idCounter}`;
  };

  const mergeStringArrays = (
    existing: string[] | undefined,
    incoming: string[] | undefined
  ): string[] | undefined => {
    if (!incoming || incoming.length === 0) {
      return existing;
    }
    if (!existing || existing.length === 0) {
      return incoming;
    }
    const merged = new Set<string>(existing);
    incoming.forEach((item) => merged.add(item));
    return Array.from(merged).sort((a, b) => a.localeCompare(b));
  };

  const packagesMap = new Map<string, PackageInfo>();
  const visited = new Set<unknown>();

  const mergePackageFields = (target: PackageInfo, source: PackageInfo) => {
    target.sources = Array.from(
      new Set([...target.sources, ...source.sources])
    );

    if (!target.version && source.version) {
      target.version = source.version;
    }

    if (!target.path && source.path) {
      target.path = source.path;
    }

    if (!target.resolved && source.resolved) {
      target.resolved = source.resolved;
    }

    if (!target.integrity && source.integrity) {
      target.integrity = source.integrity;
    }

    if (target.dev === undefined && source.dev !== undefined) {
      target.dev = source.dev;
    }

    if (target.optional === undefined && source.optional !== undefined) {
      target.optional = source.optional;
    }

    if (target.peer === undefined && source.peer !== undefined) {
      target.peer = source.peer;
    }

    if (target.extraneous === undefined && source.extraneous !== undefined) {
      target.extraneous = source.extraneous;
    }

    target.dependencies = mergeStringArrays(
      target.dependencies,
      source.dependencies
    );
    target.requires = mergeStringArrays(target.requires, source.requires);
    target.peerDependencies = mergeStringArrays(
      target.peerDependencies,
      source.peerDependencies
    );
    target.bundledDependencies = mergeStringArrays(
      target.bundledDependencies,
      source.bundledDependencies
    );

    target.raw = {
      ...(target.raw ?? {}),
      ...(source.raw ?? {}),
    };
  };

  const findMatchingId = (candidate: PackageInfo): string | undefined => {
    if (!candidate.name) {
      return undefined;
    }

    for (const existing of packagesMap.values()) {
      if (existing.name !== candidate.name) {
        continue;
      }

      if (!candidate.version || existing.version === candidate.version) {
        return existing.id;
      }
    }

    return undefined;
  };

  const mergePackageInfo = (candidate: PackageInfo) => {
    const targetId = findMatchingId(candidate) ?? candidate.id;
    const existing = packagesMap.get(targetId);

    if (!existing) {
      candidate.id = targetId;
      packagesMap.set(targetId, candidate);
      return;
    }

    mergePackageFields(existing, candidate);
  };

  const createCandidate = (
    source: "packages" | "dependencies",
    nameInput: string | undefined,
    infoRecord: Record<string, unknown>,
    path?: string
  ): PackageInfo | undefined => {
    const infoName = asString(infoRecord["name"]);
    const name = nameInput ?? infoName ?? "";
    const trimmedName = name.trim();

    if (!trimmedName) {
      return undefined;
    }

    const version = asString(infoRecord["version"]);
    const resolved = asString(infoRecord["resolved"]);
    const integrity = asString(infoRecord["integrity"]);
    const dev = asBoolean(infoRecord["dev"]);
    const optional = asBoolean(infoRecord["optional"]);
    const peer = asBoolean(infoRecord["peer"]);
    const extraneous = asBoolean(infoRecord["extraneous"]);
    const dependencies = keysOf(infoRecord["dependencies"]);
    const requires = keysOf(infoRecord["requires"]);
    const peerDependencies = keysOf(infoRecord["peerDependencies"]);
    const bundledDependencies =
      arrayOfStrings(infoRecord["bundledDependencies"]) ??
      arrayOfStrings(infoRecord["bundleDependencies"]);

    const id = createId(source, [path, trimmedName, version]);

    const candidate: PackageInfo = {
      id,
      name: trimmedName,
      version,
      resolved,
      integrity,
      dev,
      optional,
      peer,
      extraneous,
      path,
      dependencies,
      requires,
      peerDependencies,
      bundledDependencies,
      sources: [source],
      raw: infoRecord,
    };

    return candidate;
  };

  const collectDependencies = (deps: unknown) => {
    if (!isRecord(deps)) {
      return;
    }

    for (const [depName, depInfo] of Object.entries(deps)) {
      if (!isRecord(depInfo)) {
        const infoObject: Record<string, unknown> =
          typeof depInfo === "string" ? { version: depInfo } : {};
        const candidate = createCandidate("dependencies", depName, infoObject);
        if (candidate) {
          mergePackageInfo(candidate);
        }
        continue;
      }

      const candidate = createCandidate("dependencies", depName, depInfo);
      if (candidate) {
        mergePackageInfo(candidate);
      }

      if (!visited.has(depInfo)) {
        visited.add(depInfo);
        const nestedDeps = depInfo["dependencies"];
        if (nestedDeps) {
          collectDependencies(nestedDeps);
        }
      }
    }
  };

  const collectPackages = (packages: unknown) => {
    if (!isRecord(packages)) {
      return;
    }

    for (const [packagePath, info] of Object.entries(packages)) {
      if (!isRecord(info)) {
        continue;
      }

      const derivedName =
        deriveNameFromPath(packagePath) ?? asString(info["name"]);
      const candidate = createCandidate(
        "packages",
        derivedName,
        info,
        packagePath || undefined
      );

      if (candidate) {
        mergePackageInfo(candidate);
      }

      if (!visited.has(info)) {
        visited.add(info);
        const nestedDeps = info["dependencies"];
        if (nestedDeps) {
          collectDependencies(nestedDeps);
        }
      }
    }
  };

  const lockRecord = lockFile as Record<string, unknown>;

  const packagesSection = lockRecord["packages"];
  if (packagesSection) {
    collectPackages(packagesSection);
  }

  const dependenciesSection = lockRecord["dependencies"];
  if (dependenciesSection) {
    collectDependencies(dependenciesSection);
  }

  const fromPackages = Array.from(packagesMap.values()).filter((pkg) =>
    pkg.sources.includes("packages")
  );

  const dedupByNameAndVersion = new Map<string, PackageInfo>();

  for (const pkg of fromPackages) {
    const key = `${pkg.name}__${pkg.version ?? ""}`;
    const existing = dedupByNameAndVersion.get(key);
    if (!existing) {
      dedupByNameAndVersion.set(key, pkg);
    } else {
      mergePackageFields(existing, pkg);
    }
  }

  return Array.from(dedupByNameAndVersion.values()).sort((a, b) => {
    const nameCompare = a.name.localeCompare(b.name);
    if (nameCompare !== 0) {
      return nameCompare;
    }

    const versionA = a.version ?? "";
    const versionB = b.version ?? "";
    return versionA.localeCompare(versionB);
  });
}

export default function Home() {
  const [packageString, setPackageString] = useState("");
  const { packages, error } = useMemo(() => {
    if (!packageString.trim()) {
      return { packages: [] as PackageInfo[], error: "" };
    }

    try {
      const parsed = JSON.parse(packageString);
      const extracted = extractPackages(parsed);
      if (extracted.length === 0) {
        return { packages: [], error: "no packages found" };
      }
      return { packages: extracted, error: "" };
    } catch {
      return { packages: [] as PackageInfo[], error: "not valid json" };
    }
  }, [packageString]);

  return (
    <div className="grid-cols-3 grid gap-4">
      <div className="border border-border p-4 col-span-2 h-fit">
        <Label className="mb-2">Paste your requirements file:</Label>
        <Textarea
          className="resize-none h-60 overflow-y-scroll"
          value={packageString}
          spellCheck={false}
          onChange={(e) => setPackageString(e.target.value)}
        />
      </div>
      <div className="border border-border p-4 col-span-1">
        <h1 className="mb-2">Packages ({packages.length})</h1>
        <div className="flex flex-col gap-2">
          {error ? (
            <div className="p-2 border border-border text-sm text-red-600">
              {error}
            </div>
          ) : packages.length === 0 ? (
            <div className="p-2 border border-border text-sm text-muted-foreground">
              No packages to display yet.
            </div>
          ) : (
            packages.map((pkg) => {
              const flagParts: string[] = [];
              if (pkg.dev !== undefined) {
                flagParts.push(`dev: ${pkg.dev ? "true" : "false"}`);
              }
              if (pkg.optional !== undefined) {
                flagParts.push(`optional: ${pkg.optional ? "true" : "false"}`);
              }
              if (pkg.peer !== undefined) {
                flagParts.push(`peer: ${pkg.peer ? "true" : "false"}`);
              }

              return (
                <div
                  key={pkg.id}
                  className="p-2 border border-border space-y-1"
                >
                  <div className="font-medium">{pkg.name}</div>
                  {pkg.version && (
                    <div className="text-sm text-muted-foreground">
                      Version: {pkg.version}
                    </div>
                  )}
                  {pkg.path && (
                    <div className="text-xs text-muted-foreground break-all">
                      Path: {pkg.path}
                    </div>
                  )}
                  {pkg.resolved && (
                    <div className="text-xs text-muted-foreground break-all">
                      Resolved: {pkg.resolved}
                    </div>
                  )}
                  {pkg.integrity && (
                    <div className="text-xs text-muted-foreground break-all">
                      Integrity: {pkg.integrity}
                    </div>
                  )}
                  {flagParts.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {flagParts.join(" · ")}
                    </div>
                  )}
                  {pkg.dependencies && (
                    <div className="text-xs text-muted-foreground">
                      Dependencies: {pkg.dependencies.join(", ")}
                    </div>
                  )}
                  {pkg.requires && (
                    <div className="text-xs text-muted-foreground">
                      Requires: {pkg.requires.join(", ")}
                    </div>
                  )}
                  {pkg.peerDependencies && (
                    <div className="text-xs text-muted-foreground">
                      Peer deps: {pkg.peerDependencies.join(", ")}
                    </div>
                  )}
                  {pkg.bundledDependencies && (
                    <div className="text-xs text-muted-foreground">
                      Bundled deps: {pkg.bundledDependencies.join(", ")}
                    </div>
                  )}
                  {pkg.sources.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Sources: {pkg.sources.join(", ")}
                    </div>
                  )}
                  {pkg.raw && (
                    <pre className="mt-2 max-h-40 overflow-auto bg-muted p-2 text-xs">
                      {JSON.stringify(pkg.raw, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
      <div className="bg-green-500">3</div>
      <div className="bg-yellow-500">4</div>
    </div>
  );
}

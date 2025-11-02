"use client";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Check,
  CircleAlert,
  CircleQuestionMark,
  TriangleAlert,
  ExternalLink,
  Star,
  Archive,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type PackageInfo = {
  id: string;
  name: string;
  version?: string;
  latest?: string;
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
  gitUrl?: string;
  loading: boolean;
  npmUrl?: string;
  humanReadableNpmUrl?: string;
  localOnly?: boolean;
  lastCommitDate?: string;
  isExplicit?: boolean;
  vulnerabilityCount?: number;
  vulnerabilitySeverity?: "critical" | "high" | "moderate" | "low" | "info";
  license?: string;
  starCount?: number;
  homepageUrl?: string;
  isDeprecated?: boolean;
  size?: number;
  humanReadableSize?: string;
};

type AuditSummary = {
  critical: number;
  high: number;
  moderate: number;
  low: number;
  info: number;
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
      loading: true,
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

  const explicitDeps = new Set<string>();
  const packagesSection = lockRecord["packages"];
  if (isRecord(packagesSection)) {
    const rootPackage = packagesSection[""];
    if (isRecord(rootPackage)) {
      const deps = rootPackage["dependencies"];
      const devDeps = rootPackage["devDependencies"];

      if (isRecord(deps)) {
        Object.keys(deps).forEach((name) => explicitDeps.add(name));
      }
      if (isRecord(devDeps)) {
        Object.keys(devDeps).forEach((name) => explicitDeps.add(name));
      }
    }
  }

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
      pkg.isExplicit = explicitDeps.has(pkg.name);
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

function getMonthsAgo(dateString: string): number {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  return diffMs / (1000 * 60 * 60 * 24 * 30.44);
}

function getOutdatedSeverity(
  pkg: PackageInfo
): "low" | "moderate" | "high" | "critical" {
  if (!pkg.latest || !pkg.version || pkg.latest === pkg.version) {
    return "low";
  }

  const currentParts = pkg.version.split(".").map((n) => parseInt(n) || 0);
  const latestParts = pkg.latest.split(".").map((n) => parseInt(n) || 0);

  const majorDiff = latestParts[0] - currentParts[0];
  const minorDiff = latestParts[1] - currentParts[1];

  if (majorDiff > 0) {
    return "critical";
  }

  if (minorDiff > 2) {
    return "high";
  }

  if (minorDiff > 0) {
    return "moderate";
  }

  return "low";
}

function formatTimeSince(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30.44);
  const diffYears = Math.floor(diffDays / 365.25);

  if (diffYears > 0) {
    return diffYears === 1 ? "1 year" : `${diffYears} years`;
  } else if (diffMonths > 0) {
    return diffMonths === 1 ? "1 month" : `${diffMonths} months`;
  } else if (diffWeeks > 0) {
    return diffWeeks === 1 ? "1 week" : `${diffWeeks} weeks`;
  } else {
    if (diffDays === 0) {
      return "today";
    }
    return diffDays === 1 ? "1 day" : `${diffDays} days`;
  }
}

function normalizeGitUrl(gitUrl: string): string | undefined {
  if (!gitUrl || typeof gitUrl !== "string") {
    return undefined;
  }

  let normalized = gitUrl.trim();

  if (normalized.startsWith("git+")) {
    normalized = normalized.substring(4);
  }

  if (normalized.startsWith("git://")) {
    normalized = normalized.replace(/^git:\/\//, "https://");
  }

  if (normalized.startsWith("git@")) {
    const sshMatch = normalized.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
    if (sshMatch) {
      const [, host, path] = sshMatch;
      normalized = `https://${host}/${path}`;
    } else {
      return undefined;
    }
  }

  if (normalized.endsWith(".git")) {
    normalized = normalized.substring(0, normalized.length - 4);
  }

  try {
    new URL(normalized);
    return normalized;
  } catch {
    return undefined;
  }
}

function normalizeNpmUrl(packageName: string, version?: string): string {
  const cleanName = packageName.trim();
  const cleanVersion = version?.trim() ?? "latest";
  return `https://www.npmjs.com/package/${encodeURIComponent(
    cleanName
  )}/v/${encodeURIComponent(cleanVersion)}`;
}

function formatBytes(bytes: number): string {
  if (typeof bytes !== "number" || Number.isNaN(bytes)) return "unknown";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  // show integer for bytes, one decimal place otherwise
  const formatted = i === 0 ? Math.round(value).toString() : value.toFixed(1);
  return `${formatted} ${sizes[i]}`;
}

export default function Home() {
  const [packageString, setPackageString] = useState("");
  const [packages, setPackages] = useState<PackageInfo[]>([]);
  const [error, setError] = useState("");
  const [showExplicitOnly, setShowExplicitOnly] = useState(false);
  const [auditSummary, setAuditSummary] = useState<AuditSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const processInput = async () => {
      const trimmed = packageString.trim();
      if (!trimmed) {
        setPackages([]);
        setError("");
        return;
      }

      try {
        const parsed = JSON.parse(packageString);
        const extracted = extractPackages(parsed);
        if (extracted.length === 0) {
          setPackages([]);
          setError("no packages found");
          return;
        }

        const initialPackages = extracted.map((pkg) => ({
          ...pkg,
          loading: true,
          localOnly: !pkg.resolved,
        }));

        setPackages(initialPackages);
        setError("");

        const fetchPackageData = async (pkg: PackageInfo, index: number) => {
          if (cancelled) {
            return;
          }

          if (!pkg.resolved) {
            setPackages((prev) => {
              if (cancelled || index >= prev.length) {
                return prev;
              }

              const current = prev[index];
              if (!current.loading) {
                return prev;
              }

              const next = [...prev];
              next[index] = {
                ...current,
                loading: false,
                localOnly: true,
              };
              return next;
            });
            return;
          }

          const npmUrl = `https://registry.npmjs.org/${pkg.name}`;
          try {
            const response = await fetch(npmUrl, { signal: controller.signal });

            if (!response.ok) {
              throw new Error(`Request failed with status ${response.status}`);
            }

            const rawPayload = await response.json();

            if (cancelled) {
              return;
            }

            // determine the latest version, then prefer the exact version payload if available;
            // otherwise try the latest version payload
            const latestVersion = rawPayload["dist-tags"]?.latest;
            const payload = pkg.version
              ? rawPayload.versions?.[pkg.version]
              : latestVersion
              ? rawPayload.versions?.[latestVersion]
              : undefined;

            const rawGitUrl =
              payload?.repository?.type === "git"
                ? (payload?.repository?.url as string | undefined)
                : undefined;

            const license = payload?.license ?? "unknown";

            const gitUrl = rawGitUrl ? normalizeGitUrl(rawGitUrl) : undefined;

            const homepageUrl = payload?.homepage;

            let lastCommitDate: string | undefined;
            let starCount: number | undefined;
            let isDeprecated: boolean | undefined;
            let packageSize: number | undefined;
            let humanReadableSize: string | undefined;
            if (gitUrl && !cancelled) {
              try {
                const url = new URL(gitUrl);
                const hostname = url.hostname;
                const pathParts = url.pathname.split("/").filter(Boolean);

                if (pathParts.length >= 2) {
                  const owner = pathParts[0];
                  const repo = pathParts[1].replace(/\.git$/, "");

                  const commitDataPromise = (async () => {
                    if (hostname === "github.com") {
                      const apiResponse = await fetch("/api/github-commit", {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({ owner, repo }),
                        signal: controller.signal,
                      });

                      if (apiResponse.ok) {
                        const apiData = await apiResponse.json();
                        return {
                          lastCommitDate: apiData.lastCommitDate,
                          starCount: apiData.starCount,
                          isArchived: apiData.isArchived,
                        };
                      }
                    } else if (hostname === "gitlab.com") {
                      const apiBase = "https://gitlab.com/api/v4";
                      const repoUrl = `${apiBase}/projects/${encodeURIComponent(
                        `${owner}/${repo}`
                      )}`;

                      const repoResponse = await fetch(repoUrl, {
                        signal: controller.signal,
                      });

                      if (repoResponse.ok) {
                        const repoData = await repoResponse.json();
                        const defaultBranch = repoData.default_branch || "main";
                        const commitsUrl = `${repoUrl}/repository/commits?ref_name=${defaultBranch}`;

                        const commitResponse = await fetch(commitsUrl, {
                          signal: controller.signal,
                        });

                        if (commitResponse.ok) {
                          const commitData = await commitResponse.json();
                          const latestCommit = Array.isArray(commitData)
                            ? commitData[0]
                            : commitData;

                          if (latestCommit) {
                            return {
                              lastCommitDate: latestCommit.committed_date,
                              starCount: repoData.star_count,
                            };
                          }
                        }
                      }
                    } else if (hostname === "bitbucket.org") {
                      const apiBase = "https://api.bitbucket.org/2.0";
                      const repoUrl = `${apiBase}/repositories/${owner}/${repo}`;

                      const repoResponse = await fetch(repoUrl, {
                        signal: controller.signal,
                      });

                      if (repoResponse.ok) {
                        const repoData = await repoResponse.json();
                        const defaultBranch = repoData.mainbranch || "main";
                        const commitsUrl = `${repoUrl}/commits/${defaultBranch}`;

                        const commitResponse = await fetch(commitsUrl, {
                          signal: controller.signal,
                        });

                        if (commitResponse.ok) {
                          const commitData = await commitResponse.json();
                          const latestCommit = commitData.values
                            ? commitData.values[0]
                            : null;

                          if (latestCommit) {
                            return {
                              lastCommitDate: latestCommit.date,
                              starCount: undefined,
                            };
                          }
                        }
                      }
                    }
                    return { lastCommitDate: undefined, starCount: undefined };
                  })();

                  const result = await commitDataPromise;
                  lastCommitDate = result.lastCommitDate;
                  starCount = result.starCount;
                  isDeprecated = (result as { isArchived?: boolean })
                    .isArchived;
                }
              } catch (e) {
                console.error("Failed to fetch commit date", e);
              }
            }

            try {
              const dist = payload?.dist ?? undefined;
              if (dist) {
                const unpacked = (dist as Record<string, unknown>)
                  ?.unpackedSize as number | undefined;
                const sizeField = (dist as Record<string, unknown>)?.size as
                  | number
                  | undefined;
                packageSize = unpacked ?? sizeField ?? undefined;
              }
            } catch {}

            if (packageSize !== undefined) {
              humanReadableSize = formatBytes(packageSize);
            }
            setPackages((prev) => {
              if (cancelled || index >= prev.length) {
                return prev;
              }

              const current = prev[index];
              if (!current.loading) {
                return prev;
              }

              const next = [...prev];
              next[index] = {
                ...current,
                loading: false,
                latest: latestVersion,
                raw: {
                  ...(current.raw ?? {}),
                  dummyResponse: payload,
                },
                npmUrl: npmUrl,
                humanReadableNpmUrl: normalizeNpmUrl(pkg.name, pkg.version),
                gitUrl: gitUrl,
                lastCommitDate: lastCommitDate,
                license: license,
                starCount: starCount,
                size: packageSize,
                humanReadableSize: humanReadableSize,
                homepageUrl: homepageUrl,
                isDeprecated: isDeprecated,
              };
              return next;
            });
          } catch (fetchError) {
            if (cancelled || controller.signal.aborted) {
              return;
            }

            console.error(fetchError);
            console.log(`Failed to fetch data for ${pkg.name}, url: ${npmUrl}`);

            setPackages((prev) => {
              if (cancelled || index >= prev.length) {
                return prev;
              }

              const current = prev[index];
              if (!current.loading) {
                return prev;
              }

              const next = [...prev];
              next[index] = {
                ...current,
                loading: false,
              };
              return next;
            });
          }
        };

        await Promise.all(
          initialPackages.map((pkg, index) => fetchPackageData(pkg, index))
        );

        const performAudit = async () => {
          if (cancelled) {
            return;
          }

          try {
            const auditPackages: Record<string, string> = {};
            for (const pkg of extracted) {
              if (pkg.name && pkg.version) {
                auditPackages[pkg.name] = pkg.version;
              }
            }

            if (Object.keys(auditPackages).length === 0) {
              return;
            }

            const auditResponse = await fetch("/api/npm-vulnerabilities", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ packages: auditPackages }),
              signal: controller.signal,
            });

            if (!auditResponse.ok) {
              console.error("Audit failed:", auditResponse.status);
              return;
            }

            const auditData = await auditResponse.json();

            if (cancelled) {
              return;
            }

            setAuditSummary(auditData.summary);

            if (
              auditData.advisoriesByPackage &&
              typeof auditData.advisoriesByPackage === "object"
            ) {
              setPackages((prev) => {
                return prev.map((pkg) => {
                  const vulnInfo = auditData.advisoriesByPackage[pkg.name];
                  return {
                    ...pkg,
                    vulnerabilityCount: vulnInfo?.count,
                    vulnerabilitySeverity: vulnInfo?.severity as
                      | "critical"
                      | "high"
                      | "moderate"
                      | "low"
                      | "info"
                      | undefined,
                  };
                });
              });
            }
          } catch (auditError) {
            if (!cancelled && !controller.signal.aborted) {
              console.error("Audit error:", auditError);
            }
          }
        };

        await performAudit();
      } catch {
        setPackages([]);
        setError("not valid json");
      }
    };

    processInput();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [packageString]);

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="border border-border p-4 h-fit bg-background">
        <Label className="mb-2">Paste your package-lock.json file:</Label>
        <Textarea
          className="resize-none h-60 overflow-y-scroll"
          value={packageString}
          spellCheck={false}
          onChange={(e) => setPackageString(e.target.value)}
        />

        {auditSummary && packages.length > 0 && (
          <div className="border border-border p-4 mt-4 bg-card">
            <h2 className="mb-4 font-semibold">Vulnerability Summary</h2>
            <div className="grid grid-cols-5 gap-4">
              {auditSummary.critical > 0 && (
                <div className="border border-red-800 bg-red-200 text-red-800 p-3">
                  <div className="text-2xl font-bold">
                    {auditSummary.critical}
                  </div>
                  <div className="text-sm">Critical</div>
                </div>
              )}
              {auditSummary.high > 0 && (
                <div className="border border-orange-800 bg-orange-200 text-orange-800 p-3">
                  <div className="text-2xl font-bold">{auditSummary.high}</div>
                  <div className="text-sm">High</div>
                </div>
              )}
              {auditSummary.moderate > 0 && (
                <div className="border border-yellow-800 bg-yellow-200 text-yellow-800 p-3">
                  <div className="text-2xl font-bold">
                    {auditSummary.moderate}
                  </div>
                  <div className="text-sm">Moderate</div>
                </div>
              )}
              {auditSummary.low > 0 && (
                <div className="border border-blue-800 bg-blue-200 text-blue-800 p-3">
                  <div className="text-2xl font-bold">{auditSummary.low}</div>
                  <div className="text-sm">Low</div>
                </div>
              )}
              {auditSummary.info > 0 && (
                <div className="border border-gray-800 bg-gray-200 text-gray-800 p-3">
                  <div className="text-2xl font-bold">{auditSummary.info}</div>
                  <div className="text-sm">Info</div>
                </div>
              )}
              {Object.values(auditSummary).every((v) => v === 0) && (
                <div className="border border-green-800 bg-green-200 text-green-800 p-3 col-span-5">
                  <div className="text-center">No vulnerabilities found</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="border border-border p-4 bg-background">
        <h1 className="mb-2 flex flex-row justify-between">
          Packages ({packages.length}){" "}
          {packages.some((p) => p.loading) ? (
            <span>
              Loading ({packages.filter((p) => !p.loading).length} done /{" "}
              {packages.length})
              <Spinner className="inline-block ml-1" />
            </span>
          ) : packages.length > 0 ? (
            <span>
              Done <Check className="inline-block ml-1" />
            </span>
          ) : null}
        </h1>
        <div className="flex items-center gap-2 mb-4">
          <Switch
            id="explicit-only"
            checked={showExplicitOnly}
            onCheckedChange={setShowExplicitOnly}
          />
          <Label htmlFor="explicit-only" className="cursor-pointer">
            Show only explicit dependencies (
            {packages.filter((p) => p.isExplicit).length})
          </Label>
        </div>
        <div className="flex flex-col gap-2 row-span-2">
          {error ? (
            <div className="p-2 border border-border text-sm text-red-600">
              {error}
            </div>
          ) : packages.length === 0 ? (
            <div className="p-2 border border-border text-sm text-muted-foreground">
              No packages to display yet.
            </div>
          ) : (
            [...packages]
              .filter((pkg) => !showExplicitOnly || pkg.isExplicit)
              .sort((a, b) => {
                const aArchived = a.isDeprecated && !a.loading && !a.localOnly;
                const bArchived = b.isDeprecated && !b.loading && !b.localOnly;

                if (aArchived && !bArchived) return -1;
                if (!aArchived && bArchived) return 1;

                const severityOrder = {
                  critical: 4,
                  high: 3,
                  moderate: 2,
                  low: 1,
                };

                const aSeverity = getOutdatedSeverity(a);
                const bSeverity = getOutdatedSeverity(b);
                const severityDiff =
                  severityOrder[bSeverity] - severityOrder[aSeverity];

                if (severityDiff !== 0) {
                  return severityDiff;
                }

                const dateA = a.lastCommitDate
                  ? new Date(a.lastCommitDate).getTime()
                  : Infinity;
                const dateB = b.lastCommitDate
                  ? new Date(b.lastCommitDate).getTime()
                  : Infinity;
                return dateA - dateB;
              })
              .map((pkg) => {
                const flagParts: string[] = [];
                if (pkg.dev !== undefined) {
                  flagParts.push(`dev: ${pkg.dev ? "true" : "false"}`);
                }
                if (pkg.optional !== undefined) {
                  flagParts.push(
                    `optional: ${pkg.optional ? "true" : "false"}`
                  );
                }
                if (pkg.peer !== undefined) {
                  flagParts.push(`peer: ${pkg.peer ? "true" : "false"}`);
                }

                const monthsAgo = pkg.lastCommitDate
                  ? getMonthsAgo(pkg.lastCommitDate)
                  : null;
                const hasGitUrl =
                  !!pkg.gitUrl && !pkg.loading && !pkg.localOnly;
                const hasNPMUrl =
                  !!pkg.humanReadableNpmUrl && !pkg.loading && !pkg.localOnly;
                const hasCommitDate = monthsAgo !== null;
                const showCommitBadge = hasCommitDate;
                const showUnknownBadge =
                  !hasCommitDate && !pkg.loading && (hasGitUrl || hasNPMUrl);
                const showRepoLink = hasGitUrl;
                const showNPMLink = hasNPMUrl;
                const showLicense = pkg.license && pkg.license !== "unknown";
                const hasVulnerabilities =
                  pkg.vulnerabilityCount !== undefined &&
                  pkg.vulnerabilityCount > 0;
                const isOutdated =
                  pkg.latest && pkg.version && pkg.latest !== pkg.version;
                const outdatedSeverity = getOutdatedSeverity(pkg);
                const hasStarCount =
                  pkg.starCount !== undefined && !pkg.loading && !pkg.localOnly;
                const isDeprecatedRepo =
                  pkg.isDeprecated && !pkg.loading && !pkg.localOnly;

                return (
                  <div
                    key={pkg.id}
                    className="p-2 border border-border grid grid-cols-[1fr_auto] gap-4 items-start bg-card overflow-hidden"
                  >
                    <div className="font-medium text-left">
                      <div className="flex items-center">
                        <span className="truncate">{pkg.name}</span>
                        {showLicense && (
                          <>
                            <span className="inline-block size-2 mx-2.5 bg-muted-foreground" />
                            <Link
                              href={`https://spdx.org/licenses/${pkg.license}.html`}
                              className="text-sm text-blue-600 hover:underline flex items-center gap-1 whitespace-nowrap"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {pkg.license} License
                              <ExternalLink className="size-3" />
                            </Link>
                          </>
                        )}
                      </div>
                      {pkg.version && (
                        <span className="text-sm text-muted-foreground">
                          {" v" + pkg.version}
                        </span>
                      )}

                      {isOutdated && (
                        <>
                          <span className="inline-block size-2 mx-2.5 bg-muted-foreground" />
                          <span
                            className={`text-sm ${
                              outdatedSeverity === "critical"
                                ? "text-red-500"
                                : outdatedSeverity === "high"
                                ? "text-orange-500"
                                : outdatedSeverity === "moderate"
                                ? "text-yellow-500"
                                : "text-blue-500"
                            }`}
                          >
                            Latest: v{pkg.latest}
                          </span>
                        </>
                      )}
                      <br />
                      {pkg.humanReadableSize && (
                        <span className="text-muted-foreground text-sm">
                          {pkg.humanReadableSize}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      {pkg.loading && (
                        <span className="text-sm bg-secondary text-secondary-foreground px-2 py-1 whitespace-nowrap h-full flex items-center border border-border">
                          Loading
                          <Spinner className="inline-block ml-1" />
                        </span>
                      )}
                      {hasVulnerabilities && (
                        <span
                          className={`text-sm px-2 py-1 border flex items-center justify-end gap-1 ${
                            pkg.vulnerabilitySeverity === "critical"
                              ? "bg-red-200 text-red-800 border-red-800"
                              : pkg.vulnerabilitySeverity === "high"
                              ? "bg-orange-200 text-orange-800 border-orange-800"
                              : pkg.vulnerabilitySeverity === "moderate"
                              ? "bg-yellow-200 text-yellow-800 border-yellow-800"
                              : "bg-blue-200 text-blue-800 border-blue-800"
                          }`}
                        >
                          {pkg.vulnerabilityCount} vulnerability
                          {pkg.vulnerabilityCount !== 1 ? "ies" : ""}
                          <CircleAlert className="size-4" />
                        </span>
                      )}
                      {isDeprecatedRepo && (
                        <span className="text-sm px-2 py-1 border flex items-center justify-end gap-1 bg-purple-200 text-purple-800 border-purple-800">
                          Archived
                          <Archive className="size-4" />
                        </span>
                      )}
                      {hasStarCount && (
                        <span className="text-sm px-2 py-1 border flex items-center justify-end gap-1 bg-yellow-200 text-yellow-800 border-yellow-800">
                          {pkg.starCount!.toLocaleString()}
                          <Star className="size-4" />
                        </span>
                      )}

                      {showCommitBadge && (
                        <span
                          className={`text-sm px-2 py-1 border flex items-center justify-end gap-1 ${
                            monthsAgo! > 18
                              ? "bg-red-200 text-red-800 border-red-800"
                              : monthsAgo! > 6
                              ? "bg-yellow-200 text-yellow-800 border-yellow-800"
                              : "bg-green-200 text-green-800 border-green-800"
                          }`}
                        >
                          {formatTimeSince(pkg.lastCommitDate!)}
                          {monthsAgo! > 18 ? (
                            <TriangleAlert className="size-4" />
                          ) : monthsAgo! > 6 ? (
                            <CircleAlert className="size-4" />
                          ) : (
                            <Check className="size-4" />
                          )}
                        </span>
                      )}
                      {showUnknownBadge && (
                        <span className="text-sm text-secondary-foreground bg-secondary px-2 py-1 border border-border flex items-center justify-end gap-1">
                          Unknown
                          <CircleQuestionMark className="size-4" />
                        </span>
                      )}
                      {showRepoLink && (
                        <Link
                          href={pkg.gitUrl!}
                          className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Repo
                          <ExternalLink className="size-3" />
                        </Link>
                      )}
                      {showNPMLink && (
                        <Link
                          href={pkg.humanReadableNpmUrl!}
                          className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          NPM
                          <ExternalLink className="size-3" />
                        </Link>
                      )}
                      {pkg.homepageUrl && (
                        <Link
                          href={pkg.homepageUrl}
                          className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Homepage
                          <ExternalLink className="size-3" />
                        </Link>
                      )}
                      {!pkg.loading && pkg.localOnly && (
                        <span className="text-sm text-secondary-foreground bg-secondary px-2 py-1 border border-border">
                          Local only
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
          )}
        </div>
      </div>
    </div>
  );
}

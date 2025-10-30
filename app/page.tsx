"use client";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  Check,
  CircleAlert,
  CircleQuestionMark,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

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
  gitUrl?: string;
  loading: boolean;
  npmUrl?: string;
  localOnly?: boolean;
  lastCommitDate?: string;
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

function getMonthsAgo(dateString: string): number {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  return diffMs / (1000 * 60 * 60 * 24 * 30.44);
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

export default function Home() {
  const [packageString, setPackageString] = useState("");
  const [packages, setPackages] = useState<PackageInfo[]>([]);
  const [error, setError] = useState("");

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

        for (let index = 0; index < initialPackages.length; index += 1) {
          if (cancelled) {
            break;
          }

          if (!initialPackages[index].resolved) {
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
            continue;
          }

          const npmUrl = `https://registry.npmjs.org/${
            initialPackages[index].name
          }/${initialPackages[index].version ?? "latest"}`;

          try {
            const response = await fetch(npmUrl, { signal: controller.signal });

            if (!response.ok) {
              throw new Error(`Request failed with status ${response.status}`);
            }

            const payload = await response.json();

            if (cancelled) {
              break;
            }

            const gitUrl =
              payload.repository?.type === "git"
                ? (payload.repository?.url as string | undefined)
                : undefined;

            let lastCommitDate: string | undefined;
            if (gitUrl && !cancelled) {
              try {
                let normalizedUrl = gitUrl;
                if (gitUrl.startsWith("git+")) {
                  normalizedUrl = gitUrl.substring(4);
                }
                if (gitUrl.startsWith("git@")) {
                  const sshMatch = gitUrl.match(/^git@([^:]+):(.+)\.git$/);
                  if (sshMatch) {
                    const [, host, path] = sshMatch;
                    normalizedUrl = `https://${host}/${path}`;
                  } else {
                    throw new Error("Unsupported SSH git URL format");
                  }
                }

                const url = new URL(normalizedUrl);
                const hostname = url.hostname;
                const pathParts = url.pathname.split("/").filter(Boolean);

                if (pathParts.length >= 2) {
                  const owner = pathParts[0];
                  const repo = pathParts[1].replace(/\.git$/, "");

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
                      lastCommitDate = apiData.lastCommitDate;
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
                          lastCommitDate = latestCommit.committed_date;
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
                          lastCommitDate = latestCommit.date;
                        }
                      }
                    }
                  }
                }
              } catch (e) {
                console.error("Failed to fetch commit date", e);
              }
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
                raw: {
                  ...(current.raw ?? {}),
                  dummyResponse: payload,
                },
                npmUrl: npmUrl,
                gitUrl: gitUrl,
                lastCommitDate: lastCommitDate,
              };
              return next;
            });
          } catch (fetchError) {
            if (cancelled || controller.signal.aborted) {
              break;
            }

            console.error(fetchError);
            console.log(
              `Failed to fetch data for ${initialPackages[index].name}, url: ${npmUrl}`
            );

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
        }
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
            [...packages]
              .sort((a, b) => {
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

                return (
                  <div
                    key={pkg.id}
                    className="p-2 border border-border flex items-start gap-2"
                  >
                    <div className="font-medium flex-1">
                      {pkg.name}
                      {pkg.version && (
                        <span className="text-sm text-muted-foreground">
                          {" v" + pkg.version}
                        </span>
                      )}
                    </div>

                    {pkg.loading && (
                      <span className="text-sm bg-secondary text-secondary-foreground px-2 py-1 whitespace-nowrap shrink-0 h-full flex items-center border border-border">
                        Loading
                        <Spinner className="inline-block ml-1" />
                      </span>
                    )}
                    {pkg.gitUrl && monthsAgo !== null && (
                      <>
                        {monthsAgo > 18 && (
                          <Link
                            href={pkg.gitUrl}
                            className="text-sm bg-red-200 text-red-800 px-2 py-1 shrink-0 border border-red-800"
                          >
                            {formatTimeSince(pkg.lastCommitDate!)}
                            <TriangleAlert className="inline-block ml-1 size-4" />
                          </Link>
                        )}
                        {monthsAgo > 6 && monthsAgo <= 18 && (
                          <Link
                            href={pkg.gitUrl}
                            className="text-sm bg-yellow-200 text-yellow-800 px-2 py-1 shrink-0 border border-yellow-800"
                          >
                            {formatTimeSince(pkg.lastCommitDate!)}
                            <CircleAlert className="inline-block ml-1 size-4" />
                          </Link>
                        )}
                        {monthsAgo <= 6 && (
                          <Link
                            href={pkg.gitUrl}
                            className="text-sm bg-green-200 text-green-800 px-2 py-1 shrink-0 border border-green-800"
                          >
                            {formatTimeSince(pkg.lastCommitDate!)}
                            <Check className="inline-block ml-1 size-4" />
                          </Link>
                        )}
                      </>
                    )}
                    {monthsAgo === null &&
                      pkg.gitUrl &&
                      !pkg.loading &&
                      !pkg.localOnly && (
                        <Link
                          href={pkg.gitUrl}
                          className="text-sm text-secondary-foreground bg-secondary px-2 py-1 shrink-0 border border-border"
                        >
                          Unknown
                          <CircleQuestionMark className="inline-block ml-1 size-4" />
                        </Link>
                      )}
                    {!pkg.loading && pkg.localOnly && (
                      <span className="text-sm text-secondary-foreground bg-secondary px-2 py-1 shrink-0 border border-border">
                        Local only
                        <CircleQuestionMark className="inline-block ml-1 size-4" />
                      </span>
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

import { NextRequest, NextResponse } from "next/server";

interface AuditRequest {
  packages: Record<string, string>;
}

interface VulnerabilityData {
  vulnerabilities: number;
  advisories: Array<{
    id: number;
    severity: "critical" | "high" | "moderate" | "low" | "info";
    title: string;
    description?: string;
    url?: string;
  }>;
}

export async function POST(request: NextRequest) {
  try {
    const body: AuditRequest = await request.json();
    const { packages } = body;

    if (!packages || typeof packages !== "object") {
      return NextResponse.json(
        { error: "Missing or invalid packages object" },
        { status: 400 }
      );
    }

    const auditUrl =
      "https://registry.npmjs.org/-/npm/v1/security/audits/quick";

    try {
      const auditResponse = await fetch(auditUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "putesco",
        },
        body: JSON.stringify({ packages }),
      });

      if (!auditResponse.ok) {
        return NextResponse.json(
          { error: `NPM audit API failed: ${auditResponse.status}` },
          { status: auditResponse.status }
        );
      }

      const auditData = await auditResponse.json();

      const vulnerabilities = auditData.vulnerabilities || {};
      const metadata = auditData.metadata || {};

      const advisoriesBySeverity = {
        critical: 0,
        high: 0,
        moderate: 0,
        low: 0,
        info: 0,
      };

      const advisoriesByPackage: Record<
        string,
        {
          count: number;
          severity: string;
          vulnerabilities: Array<{ id: number; title: string }>;
        }
      > = {};

      const advisories: VulnerabilityData["advisories"] = [];

      for (const [pkgName, vulnData] of Object.entries(vulnerabilities)) {
        if (
          typeof vulnData === "object" &&
          vulnData !== null &&
          "via" in vulnData
        ) {
          const via = (vulnData as { via: unknown }).via;
          if (Array.isArray(via)) {
            let maxSeverity = "info";
            const severityOrder = {
              critical: 4,
              high: 3,
              moderate: 2,
              low: 1,
              info: 0,
            };
            const pkgVulns = [];

            for (const advisory of via) {
              if (
                typeof advisory === "object" &&
                advisory !== null &&
                "title" in advisory &&
                "severity" in advisory
              ) {
                const severity = (advisory as Record<string, unknown>)
                  .severity as string;
                const severityKey =
                  severity as keyof typeof advisoriesBySeverity;

                if (severityKey in advisoriesBySeverity) {
                  advisoriesBySeverity[severityKey]++;
                }

                if (
                  severityOrder[severity as keyof typeof severityOrder] >
                  severityOrder[maxSeverity as keyof typeof severityOrder]
                ) {
                  maxSeverity = severity;
                }

                const advisoryId = (advisory as Record<string, unknown>)
                  .id as number;
                pkgVulns.push({
                  id: advisoryId,
                  title: (advisory as Record<string, unknown>).title as string,
                });

                advisories.push({
                  id: advisoryId,
                  severity:
                    severity as VulnerabilityData["advisories"][0]["severity"],
                  title: (advisory as Record<string, unknown>).title as string,
                  description: (advisory as Record<string, unknown>)
                    .description as string | undefined,
                  url: (advisory as Record<string, unknown>).url as
                    | string
                    | undefined,
                });
              }
            }

            if (pkgVulns.length > 0) {
              advisoriesByPackage[pkgName] = {
                count: pkgVulns.length,
                severity: maxSeverity,
                vulnerabilities: pkgVulns,
              };
            }
          }
        }
      }

      const totalVulnerabilities =
        (metadata.vulnerabilities as number) ||
        Object.keys(vulnerabilities).length;

      return NextResponse.json({
        vulnerabilities: totalVulnerabilities,
        advisories: advisories.slice(0, 10),
        advisoriesByPackage,
        summary: advisoriesBySeverity,
        metadata,
      });
    } catch (auditError) {
      console.error("NPM audit error:", auditError);
      return NextResponse.json(
        { error: "Failed to perform audit" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Audit API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
